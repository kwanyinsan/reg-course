const appOrigin = process.env.APP_ORIGIN;
let parsedOrigin;
try {
    parsedOrigin = new URL(appOrigin);
} catch {
    throw new Error('APP_ORIGIN must be the frontend origin.');
}
if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== appOrigin) {
    throw new Error('APP_ORIGIN must contain only a valid HTTP or HTTPS origin.');
}
if (process.env.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:') {
    throw new Error('Production APP_ORIGIN must use HTTPS.');
}

function requireTrustedRequest(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('Origin') !== appOrigin || req.get('X-Requested-With') !== 'reg-course') {
        return res.status(403).json({ message: 'Request origin or security header is invalid.' });
    }
    if (!req.is('application/json')) {
        return res.status(415).json({ message: 'Use application/json.' });
    }
    next();
}

const attempts = new Map();
const windowMs = 15 * 60 * 1000;

function limitLoginAttempts(req, res, next) {
    const now = Date.now();
    for (const [key, value] of attempts) {
        if (value.expiresAt <= now) attempts.delete(key);
    }
    const key = req.ip;
    let attempt = attempts.get(key);
    if (!attempt) {
        if (attempts.size >= 10000) {
            res.set('Retry-After', '900');
            return res.status(429).json({ message: 'Too many login attempts. Try again later.' });
        }
        attempt = { count: 0, expiresAt: now + windowMs };
        attempts.set(key, attempt);
    }
    if (attempt.count >= 10) {
        res.set('Retry-After', String(Math.ceil((attempt.expiresAt - now) / 1000)));
        return res.status(429).json({ message: 'Too many login attempts. Try again later.' });
    }
    attempt.count += 1;
    next();
}

module.exports = { requireTrustedRequest, limitLoginAttempts };
