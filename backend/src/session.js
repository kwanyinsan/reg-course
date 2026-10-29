const expressSession = require('express-session');
const PgSession = require('connect-pg-simple')(expressSession);
const pool = require('./db');

const secret = process.env.SESSION_SECRET;
if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes.');
}

const maxAge = Number(process.env.SESSION_MAX_AGE_MS || 8 * 60 * 60 * 1000);
if (!Number.isSafeInteger(maxAge) || maxAge <= 0) {
    throw new Error('SESSION_MAX_AGE_MS must be a positive integer.');
}

const cookieName = 'reg_course.sid';
const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
};

const sessionMiddleware = expressSession({
    name: cookieName,
    store: new PgSession({ pool, createTableIfMissing: true, disableTouch: true }),
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: { ...cookieOptions, maxAge }
});

async function startSession(req, adminId) {
    await new Promise(function regenerateSession(resolve, reject) {
        req.session.regenerate(function regenerated(error) {
            if (error) return reject(error);
            resolve();
        });
    });
    req.session.adminId = adminId;
    req.session.expiresAt = Date.now() + maxAge;
    await new Promise(function saveSession(resolve, reject) {
        req.session.save(function saved(error) {
            if (error) return reject(error);
            resolve();
        });
    });
}

async function endSession(req, res) {
    try {
        if (req.session) {
            await new Promise(function destroySession(resolve, reject) {
                req.session.destroy(function destroyed(error) {
                    if (error) return reject(error);
                    resolve();
                });
            });
        }
    } finally {
        res.clearCookie(cookieName, cookieOptions);
    }
}

module.exports = { sessionMiddleware, startSession, endSession };
