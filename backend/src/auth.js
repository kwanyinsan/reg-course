const pool = require('./db');
const writeLog = require('./log');
const { endSession } = require('./session');

async function requireAdmin(req, res, next) {
    try {
        if (!Number.isInteger(req.session.adminId) ||
            !Number.isFinite(req.session.expiresAt) ||
            req.session.expiresAt <= Date.now()) {
            await endSession(req, res);
            return res.status(401).json({ message: 'Please log in.' });
        }

        const result = await pool.query(
            `SELECT id, username FROM admin WHERE id = $1`,
            [req.session.adminId]
        );
        const admin = result.rows[0];

        if (!admin) {
            await endSession(req, res);
            await writeLog(pool, {
                actorType: 'system', event: 'admin.session_invalid',
                details: { reason: 'administrator_missing' }
            });
            return res.status(401).json({ message: 'Please log in.' });
        }

        req.admin = admin;
        next();
    } catch (error) {
        next(error);
    }
}

module.exports = requireAdmin;
