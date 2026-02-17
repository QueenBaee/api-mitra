require('dotenv').config();
const express = require('express');
const authMiddleware = require('./src/middleware/auth');
const firewallRoutes = require('./src/routes/firewall');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json());

// Health Check (tanpa auth — untuk monitoring)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Key Authentication - semua routes di bawah ini dilindungi
app.use(authMiddleware);

// ============================================================
// ROUTES
// ============================================================
app.use('/', firewallRoutes);

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route tidak ditemukan: ${req.method} ${req.originalUrl}`,
        hint: 'Gunakan /enable={ID}, /disable={ID}, atau /add={ID}?add={IP}'
    });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error('[SERVER ERROR]', err);
    res.status(500).json({
        success: false,
        message: 'Internal Server Error'
    });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log(' MikroTik Firewall API');
    console.log('========================================');
    console.log(`  Server    : http://0.0.0.0:${PORT}`);
    console.log(`  Router    : ${process.env.MIKROTIK_HOST}:${process.env.MIKROTIK_PORT}`);
    console.log(`  Auth      : API Key (x-api-key header)`);
    console.log(`  Logging   : logs/log_YYYY-MM-DD.txt (WIB)`);
    console.log('----------------------------------------');
    console.log('  Endpoints:');
    console.log(`  GET /enable={ID}         - Enable rules`);
    console.log(`  GET /disable={ID}        - Disable rules`);
    console.log(`  GET /add={ID}?add={IPs}  - Add rules`);
    console.log('========================================');
});
