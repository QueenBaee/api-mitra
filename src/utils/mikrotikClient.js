const net = require('net');

/**
 * Custom Simple MikroTik Client (Plaintext Login Only)
 * Menggunakan RouterOS API Protocol via raw TCP socket.
 * Reused & adapted from LintangData project.
 */

// --- ENCODING HELPERS ---
function encodeLength(len) {
    if (len < 0x80) return Buffer.from([len]);
    if (len < 0x4000) return Buffer.from([len >> 8 | 0x80, len & 0xFF]);
    if (len < 0x200000) return Buffer.from([len >> 16 | 0xC0, len >> 8 & 0xFF, len & 0xFF]);
    if (len < 0x10000000) return Buffer.from([len >> 24 | 0xE0, len >> 16 & 0xFF, len >> 8 & 0xFF, len & 0xFF]);
    return Buffer.from([0xF0, (len >> 24) & 0xFF, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF]);
}

function encodeWord(word) {
    const buf = Buffer.from(word);
    const len = encodeLength(buf.length);
    return Buffer.concat([len, buf]);
}

function decodeLength(buffer, offset) {
    let len = buffer[offset];
    let bytes = 1;

    if ((len & 0x80) === 0x00) {
        len = len;
    } else if ((len & 0xC0) === 0x80) {
        len = ((len & 0x3F) << 8) | buffer[offset + 1];
        bytes = 2;
    } else if ((len & 0xE0) === 0xC0) {
        len = ((len & 0x1F) << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
        bytes = 3;
    } else if ((len & 0xF0) === 0xE0) {
        len = ((len & 0x0F) << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3];
        bytes = 4;
    } else if ((len & 0xF8) === 0xF0) {
        len = buffer[offset + 1] * 0x1000000 + (buffer[offset + 2] << 16) | (buffer[offset + 3] << 8) | buffer[offset + 4];
        bytes = 5;
    }
    return { len, bytes };
}

class MikrotikClient {
    constructor(host, port, user, pass) {
        this.host = host;
        this.port = port;
        this.user = user;
        this.pass = pass;
        this.socket = null;
        this.buffer = Buffer.alloc(0);
        this.promiseQueue = [];
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = new net.Socket();
            this.socket.setTimeout(10000); // 10s timeout

            this.socket.connect(this.port, this.host, () => {
                this._sendLogin();
            });

            this.socket.on('data', (data) => this._onData(data));

            this.socket.on('timeout', () => {
                this.socket.destroy();
                if (this.promiseQueue.length > 0) {
                    const { reject: reqReject } = this.promiseQueue.shift();
                    reqReject(new Error('Connection timeout'));
                } else {
                    reject(new Error('Connection timeout'));
                }
            });

            this.socket.on('error', (err) => {
                if (this.promiseQueue.length > 0) {
                    const { reject: reqReject } = this.promiseQueue.shift();
                    reqReject(err);
                } else {
                    reject(err);
                }
            });

            this.socket.on('close', () => {
                // Cleanup
            });

            // Initial Promise is for Login
            this.promiseQueue.push({ resolve, reject });
        });
    }

    _sendLogin() {
        this.socket.write(encodeWord('/login'));
        this.socket.write(encodeWord('=name=' + this.user));
        this.socket.write(encodeWord('=password=' + this.pass));
        this.socket.write(Buffer.from([0])); // End of sentence
    }

    _onData(data) {
        this.buffer = Buffer.concat([this.buffer, data]);

        while (true) {
            let offset = 0;
            let currentSentenceWords = [];
            let isCompleteSentence = false;
            let parsedBytes = 0;

            try {
                while (offset < this.buffer.length) {
                    const { len, bytes } = decodeLength(this.buffer, offset);

                    if (len === 0) {
                        parsedBytes = offset + bytes;
                        isCompleteSentence = true;
                        break;
                    }

                    if (offset + bytes + len > this.buffer.length) {
                        break;
                    }

                    const word = this.buffer.slice(offset + bytes, offset + bytes + len).toString();
                    currentSentenceWords.push(word);
                    offset += bytes + len;
                }
            } catch (e) {
                console.error("Parse Error:", e);
                break;
            }

            if (isCompleteSentence) {
                this._processSentence(currentSentenceWords);
                this.buffer = this.buffer.slice(parsedBytes);
                continue;
            } else {
                break;
            }
        }
    }

    _processSentence(words) {
        if (words.length === 0) return;

        const type = words[0]; // !done, !trap, !re, !fatal
        const request = this.promiseQueue[0];

        if (!request) return;

        if (!request.data) request.data = [];

        if (type === '!re') {
            const obj = {};
            words.slice(1).forEach(w => {
                if (w.startsWith('=')) {
                    const parts = w.substring(1).split('=');
                    const key = parts[0];
                    const val = parts.slice(1).join('=');
                    obj[key] = val;
                }
            });
            request.data.push(obj);
        }
        else if (type === '!trap' || type === '!fatal') {
            const msg = words.find(w => w.startsWith('=message='))?.split('=')[2] || 'Unknown Error';
            request.error = new Error(msg);
        }
        else if (type === '!done') {
            const obj = {};
            words.slice(1).forEach(w => {
                if (w.startsWith('=')) {
                    const parts = w.substring(1).split('=');
                    const key = parts[0];
                    const val = parts.slice(1).join('=');
                    obj[key] = val;
                }
            });

            const finalData = request.data.length > 0 ? request.data : [obj];

            this.promiseQueue.shift();

            if (request.error) {
                request.reject(request.error);
            } else {
                request.resolve(finalData);
            }
        }
    }

    // --- PUBLIC METHODS ---

    write(command) {
        return new Promise((resolve, reject) => {
            this.promiseQueue.push({ resolve, reject });

            if (Array.isArray(command)) {
                command.forEach(word => {
                    this.socket.write(encodeWord(word));
                });
            } else {
                this.socket.write(encodeWord(command));
            }

            this.socket.write(Buffer.from([0])); // End of sentence
        });
    }

    close() {
        if (this.socket) this.socket.destroy();
    }
}

module.exports = MikrotikClient;
