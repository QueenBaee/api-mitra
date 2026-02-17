const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');

/**
 * Mendapatkan tanggal & waktu dalam timezone WIB (UTC+7)
 */
function getWIBDate() {
    const now = new Date();
    // Offset WIB = UTC+7 = +420 menit
    const wib = new Date(now.getTime() + (7 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000));
    return wib;
}

/**
 * Format tanggal WIB ke string: YYYY-MM-DD
 */
function formatDate(wib) {
    const y = wib.getFullYear();
    const m = String(wib.getMonth() + 1).padStart(2, '0');
    const d = String(wib.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Format tanggal+waktu WIB ke string: YYYY-MM-DD HH:mm:ss
 */
function formatDateTime(wib) {
    const date = formatDate(wib);
    const h = String(wib.getHours()).padStart(2, '0');
    const min = String(wib.getMinutes()).padStart(2, '0');
    const sec = String(wib.getSeconds()).padStart(2, '0');
    return `${date} ${h}:${min}:${sec}`;
}

/**
 * Tulis log ke file logs/log_YYYY-MM-DD.txt (append-only, WIB timezone)
 * 
 * @param {string} action - Nama aksi (ENABLE, DISABLE, ADD)
 * @param {string} message - Detail pesan log
 */
function writeLog(action, message) {
    try {
        // Pastikan folder logs/ ada
        if (!fs.existsSync(LOGS_DIR)) {
            fs.mkdirSync(LOGS_DIR, { recursive: true });
        }

        const wib = getWIBDate();
        const dateStr = formatDate(wib);
        const dateTimeStr = formatDateTime(wib);

        const logFile = path.join(LOGS_DIR, `log_${dateStr}.txt`);
        const logLine = `[${dateTimeStr} WIB] [${action}] ${message}\n`;

        // Append ke file (buat baru jika belum ada, TIDAK pernah menghapus)
        fs.appendFileSync(logFile, logLine, 'utf8');

        // Juga print ke console
        console.log(logLine.trim());
    } catch (err) {
        console.error('[LOGGER] Gagal menulis log:', err.message);
    }
}

module.exports = { writeLog };
