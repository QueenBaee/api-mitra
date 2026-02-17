const express = require('express');
const MikrotikClient = require('../utils/mikrotikClient');
const { writeLog } = require('../utils/logger');

const router = express.Router();

/**
 * Helper: Connect ke MikroTik dan jalankan callback
 */
async function withMikrotik(callback) {
    const host = process.env.MIKROTIK_HOST;
    const port = parseInt(process.env.MIKROTIK_PORT) || 8728;
    const user = process.env.MIKROTIK_USER;
    const pass = process.env.MIKROTIK_PASS || '';

    const client = new MikrotikClient(host, port, user, pass);

    try {
        await client.connect();
        const result = await callback(client);
        client.close();
        return result;
    } catch (err) {
        client.close();

        let msg = err.message || String(err);
        if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
            msg = 'Router Offline / Unreachable';
        }
        if (msg.includes('invalid user name or password')) {
            msg = 'Login Gagal: Username/Password salah';
        }

        throw new Error(msg);
    }
}

/**
 * Helper: Cari firewall filter rules berdasarkan comment,
 * lalu enable atau disable semua yang cocok.
 */
async function toggleFirewallRules(customerId, action) {
    const disabled = action === 'disable' ? 'yes' : 'no';

    return await withMikrotik(async (client) => {
        // 1. Cari semua firewall filter rules dengan comment yang mengandung customerId
        const rules = await client.write([
            '/ip/firewall/filter/print',
            `?comment=${customerId}`
        ]);

        const matchingRules = rules.filter(rule => rule.comment && rule.comment.includes(customerId));

        if (matchingRules.length === 0) {
            return {
                success: false,
                message: `Tidak ditemukan firewall rule dengan comment "${customerId}"`,
                rules_affected: 0
            };
        }

        // 2. Enable/Disable setiap rule yang cocok
        const results = [];
        for (const rule of matchingRules) {
            try {
                await client.write([
                    '/ip/firewall/filter/set',
                    `=.id=${rule['.id']}`,
                    `=disabled=${disabled}`
                ]);
                results.push({ id: rule['.id'], comment: rule.comment, status: 'ok' });
            } catch (err) {
                results.push({ id: rule['.id'], comment: rule.comment, status: 'error', error: err.message });
            }
        }

        const successCount = results.filter(r => r.status === 'ok').length;

        return {
            success: true,
            message: `${action === 'enable' ? 'Enabled' : 'Disabled'} ${successCount} firewall rule(s) untuk customer "${customerId}"`,
            rules_affected: successCount,
            details: results
        };
    });
}

/**
 * Helper: Tambah firewall filter rules baru.
 * - 1 IP  → filter add chain=forward src-address={IP} action=drop disabled=yes comment={ID}
 * - >1 IP → filter add chain=forward src-address-list={ID} action=drop disabled=yes comment={ID}
 *           + address-list add list={ID} address={IP} untuk tiap IP
 */
async function addFirewallRules(customerId, ipList) {
    return await withMikrotik(async (client) => {
        const results = [];

        if (ipList.length === 1) {
            // === MODE: Single IP ===
            const ip = ipList[0];
            try {
                await client.write([
                    '/ip/firewall/filter/add',
                    '=chain=forward',
                    `=src-address=${ip}`,
                    '=action=drop',
                    '=disabled=yes',
                    `=comment=${customerId}`
                ]);
                results.push({ type: 'filter-rule', ip, status: 'ok' });
            } catch (err) {
                results.push({ type: 'filter-rule', ip, status: 'error', error: err.message });
            }
        } else {
            // === MODE: Multiple IPs (Address List) ===

            // 1. Buat firewall filter rule dengan src-address-list
            try {
                await client.write([
                    '/ip/firewall/filter/add',
                    '=chain=forward',
                    `=src-address-list=${customerId}`,
                    '=action=drop',
                    '=disabled=yes',
                    `=comment=${customerId}`
                ]);
                results.push({ type: 'filter-rule', mode: 'address-list', status: 'ok' });
            } catch (err) {
                results.push({ type: 'filter-rule', mode: 'address-list', status: 'error', error: err.message });
            }

            // 2. Tambahkan setiap IP ke address-list
            for (const ip of ipList) {
                try {
                    await client.write([
                        '/ip/firewall/address-list/add',
                        `=list=${customerId}`,
                        `=address=${ip}`
                    ]);
                    results.push({ type: 'address-list', ip, status: 'ok' });
                } catch (err) {
                    results.push({ type: 'address-list', ip, status: 'error', error: err.message });
                }
            }
        }

        const successCount = results.filter(r => r.status === 'ok').length;
        const totalCount = results.length;
        const mode = ipList.length === 1 ? 'single-ip' : 'address-list';

        return {
            success: successCount > 0,
            message: `Added firewall rule(s) untuk customer "${customerId}" (${mode}): ${successCount}/${totalCount} berhasil`,
            mode,
            ips: ipList,
            rules_affected: successCount,
            details: results
        };
    });
}

// ============================================================
// ROUTES
// ============================================================

/**
 * GET /enable=:customerId
 */
router.get('/enable=:customerId', async (req, res) => {
    const { customerId } = req.params;

    try {
        const result = await toggleFirewallRules(customerId, 'enable');
        const statusCode = result.success ? 200 : 404;
        writeLog('ENABLE', `Customer: ${customerId} | Result: ${result.message} | ${result.success ? 'Success' : 'Not Found'}`);
        res.status(statusCode).json(result);
    } catch (err) {
        writeLog('ENABLE', `Customer: ${customerId} | Error: ${err.message}`);
        res.status(500).json({ success: false, message: `Gagal enable: ${err.message}` });
    }
});

/**
 * GET /disable=:customerId
 */
router.get('/disable=:customerId', async (req, res) => {
    const { customerId } = req.params;

    try {
        const result = await toggleFirewallRules(customerId, 'disable');
        const statusCode = result.success ? 200 : 404;
        writeLog('DISABLE', `Customer: ${customerId} | Result: ${result.message} | ${result.success ? 'Success' : 'Not Found'}`);
        res.status(statusCode).json(result);
    } catch (err) {
        writeLog('DISABLE', `Customer: ${customerId} | Error: ${err.message}`);
        res.status(500).json({ success: false, message: `Gagal disable: ${err.message}` });
    }
});

/**
 * GET /add=:customerId?add={IP} atau ?add={IP1},{IP2},{IP3}
 * Tambah firewall filter rules baru
 */
router.get('/add=:customerId', async (req, res) => {
    const { customerId } = req.params;
    const addParam = req.query.add;

    // Validasi: query param 'add' harus ada
    if (!addParam) {
        writeLog('ADD', `Customer: ${customerId} | Error: Parameter ?add= tidak ditemukan`);
        return res.status(400).json({
            success: false,
            message: 'Parameter ?add={IP} diperlukan. Contoh: /add=CUST001?add=103.1.2.3'
        });
    }

    // Parse IP list (comma-separated)
    const ipList = addParam.split(',').map(ip => ip.trim()).filter(ip => ip.length > 0);

    if (ipList.length === 0) {
        writeLog('ADD', `Customer: ${customerId} | Error: Tidak ada IP valid`);
        return res.status(400).json({
            success: false,
            message: 'Tidak ada IP yang valid dalam parameter add'
        });
    }

    try {
        const result = await addFirewallRules(customerId, ipList);
        writeLog('ADD', `Customer: ${customerId} | IPs: ${ipList.join(',')} | Mode: ${result.mode} | Result: ${result.message} | Success`);
        res.json(result);
    } catch (err) {
        writeLog('ADD', `Customer: ${customerId} | IPs: ${ipList.join(',')} | Error: ${err.message}`);
        res.status(500).json({ success: false, message: `Gagal add: ${err.message}` });
    }
});

module.exports = router;
