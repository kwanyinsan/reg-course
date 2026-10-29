const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const pool = require('./db');
const writeLog = require('./log');
const requireAdmin = require('./auth');
const { sessionMiddleware, startSession, endSession } = require('./session');
const { requireTrustedRequest, limitLoginAttempts } = require('./security');
const { router: courseRoutes } = require('./courses');

const app = express();
const port = Number(process.env.PORT || 3000);
const dummyHash = bcrypt.hashSync(crypto.randomBytes(32).toString('base64url'), 10);

app.get('/status', function getStatus(req, res) {
    res.json({ status: 'ok', message: 'Express backend is connected.' });
});

app.use(function preventCaching(req, res, next) {
    res.set('Cache-Control', 'no-store');
    next();
});
app.use('/courses', courseRoutes);
app.use(requireTrustedRequest);
app.use('/login', limitLoginAttempts);
app.use(express.json({ limit: '16kb', strict: false }));
app.use(sessionMiddleware);

app.post('/login', async function login(req, res) {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        typeof body.username !== 'string' || typeof body.password !== 'string' ||
        !body.username.trim() || body.username.length > 50 ||
        body.password.length === 0 || Buffer.byteLength(body.password, 'utf8') > 72) {
        await writeLog(pool, {
            actorType: 'system', event: 'admin.login_failed',
            details: { reason: 'invalid_request' }
        });
        return res.status(400).json({ message: 'Provide a valid username and password.' });
    }

    try {
        const result = await pool.query(
            `SELECT id, username, password_hash FROM admin WHERE username = $1`,
            [body.username.trim()]
        );
        const admin = result.rows[0];
        const matches = await bcrypt.compare(body.password, admin ? admin.password_hash : dummyHash);

        if (!admin || !matches) {
            await writeLog(pool, {
                actorType: 'system', event: 'admin.login_failed',
                details: { reason: 'invalid_credentials' }
            });
            return res.status(401).json({ message: 'Invalid username or password.' });
        }

        await startSession(req, admin.id);
        await writeLog(pool, { actorType: 'admin', adminId: admin.id, event: 'admin.login_succeeded' });
        res.json({ message: 'Login successful.', admin: { id: admin.id, username: admin.username } });
    } catch (error) {
        try {
            await endSession(req, res);
        } catch {
            console.error('Unable to invalidate an unsuccessful login session.');
        }
        console.error('Login failed:', error.message);
        res.status(500).json({ message: 'Unable to log in.' });
    }
});

app.get('/current', requireAdmin, function currentAdmin(req, res) {
    res.json({ admin: req.admin });
});

app.post('/logout', requireAdmin, async function logout(req, res) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ message: 'Provide a JSON object.' });
    }
    await endSession(req, res);
    try {
        await writeLog(pool, { actorType: 'admin', adminId: req.admin.id, event: 'admin.logout_succeeded' });
    } catch (error) {
        console.error('Logout recording failed:', error.message);
        return res.status(500).json({ message: 'Logged out, but unable to record logout.' });
    }
    res.json({ message: 'Logout successful.' });
});

app.use(function routeNotFound(req, res) {
    res.status(404).json({ message: 'Route not found.' });
});

app.use(async function handleError(error, req, res, next) {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') {
        if (req.path === '/login') {
            try {
                await writeLog(pool, {
                    actorType: 'system', event: 'admin.login_failed',
                    details: { reason: 'invalid_json' }
                });
            } catch {
                return res.status(500).json({ message: 'Unable to complete request.' });
            }
        }
        return res.status(400).json({ message: 'Request body must be valid JSON.' });
    }
    if (error.type === 'entity.too.large') {
        return res.status(413).json({ message: 'Request body is too large.' });
    }
    if (error.status === 400 || error.status === 415) {
        return res.status(error.status).json({ message: 'Invalid JSON request encoding.' });
    }
    console.error('Request failed:', error.message);
    res.status(500).json({ message: 'Unable to complete request.' });
});

const server = app.listen(port, '127.0.0.1', function reportStarted() {
    console.log(`Backend is running at http://127.0.0.1:${port}`);
});

server.on('error', function handleServerError(error) {
    console.error('Could not start backend:', error.message);
    process.exitCode = 1;
});
