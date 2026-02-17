/**
 * API Key Authentication Middleware
 * 
 * Memvalidasi header 'x-api-key' di setiap request.
 * Jika tidak ada atau tidak cocok, tolak dengan 401 Unauthorized.
 */
function authMiddleware(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    const validKey = process.env.API_KEY;

    if (!validKey) {
        console.error('[AUTH] API_KEY belum di-set di .env!');
        return res.status(500).json({
            success: false,
            message: 'Server misconfigured: API_KEY not set'
        });
    }

    if (!apiKey) {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized: Header x-api-key diperlukan'
        });
    }

    if (apiKey !== validKey) {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized: API Key tidak valid'
        });
    }

    next();
}

module.exports = authMiddleware;
