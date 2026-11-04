const express = require('express');
const crypto = require('node:crypto');
const pool = require('./db');
const writeLog = require('./log');
const acknowledgement = require('./acknowledgement');
const payment = require('./payment');
const { sessionStore } = require('./session');
const { availability } = require('./courses');
const { fail, exactKeys, courseIds, fingerprint, validateApplication } = require('./application-validation');

const router = express.Router();
const cookieName = 'reg_course.application';
const lifetime = 8 * 60 * 60 * 1000;
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' };
let tableReady;
const attempts = new Map();

router.use(function limitApplicationRequests(req, res, next) {
    if (Object.keys(req.query).length) return res.status(400).json({ code: 'invalid_request' });
    if (req.method === 'GET') return next();
    const now = Date.now();
    for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
    let entry = attempts.get(req.ip);
    if (!entry) {
        if (attempts.size >= 10000) return res.status(429).json({ code: 'too_many_requests' });
        entry = { until: now + 15 * 60 * 1000, count: 0 };
        attempts.set(req.ip, entry);
    }
    if (++entry.count > 120) return res.status(429).json({ code: 'too_many_requests' });
    next();
});

function browserToken(req) {
    const value = (req.headers.cookie || '').split(';').map(function trim(part) { return part.trim(); })
        .find(function applicationCookie(part) { return part.startsWith(`${cookieName}=`); })?.slice(cookieName.length + 1);
    return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

async function readySessionTable() {
    // Reuse the existing store's table creation; business data and the receipt pointer
    // are then written with the same checked-out transaction below.
    if (!tableReady) tableReady = new Promise(function checkTable(resolve, reject) {
        sessionStore.get('__application_table_check__', function checked(error) { error ? reject(error) : resolve(); });
    }).catch(function retryLater(error) { tableReady = null; throw error; });
    await tableReady;
}

async function transaction(req, res, create, operation) {
    await readySessionTable();
    const client = await pool.connect();
    let committed = false;
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        let token = browserToken(req);
        let row;
        if (token) {
            const result = await client.query('SELECT sess, expire, expire > clock_timestamp() AS active FROM session WHERE sid = $1 FOR UPDATE', [`application:${token}`]);
            row = result.rows[0];
            if (row && !row.active) row = null;
        }
        let fresh = false;
        if (!row) {
            if (!create) fail('application_expired', 401);
            fresh = true;
            token = crypto.randomBytes(32).toString('base64url');
            row = { sess: {}, expire: new Date(Date.now() + lifetime) };
            await client.query('INSERT INTO session (sid, sess, expire) VALUES ($1, $2, to_timestamp($3))', [`application:${token}`, row.sess, row.expire.getTime() / 1000]);
        }
        const result = await operation(client, row.sess);
        await client.query('UPDATE session SET sess = $2 WHERE sid = $1', [`application:${token}`, row.sess]);
        await client.query('COMMIT');
        committed = true;
        if (fresh) res.cookie(cookieName, token, { ...cookieOptions, expires: row.expire });
        return result;
    } catch (error) {
        if (!committed) await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

async function definitionFor(client, ids) {
    // Lock parents in ID order, matching question editing/publication guards.
    const courses = await client.query(
        `SELECT id, code, title, fee, sessions, state, registration_opens_at,
                registration_closes_at, payment_deadline FROM course
         WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`, [ids]);
    if (courses.rowCount !== ids.length || courses.rows.some(function unavailable(course) {
        return course.state !== 'published' || availability(course, Date.now()) !== 'open';
    })) fail('course_unavailable', 409);
    const banks = await client.query('SELECT course_id, definition FROM question WHERE course_id = ANY($1::int[]) ORDER BY course_id FOR SHARE', [ids]);
    if (banks.rowCount !== ids.length) fail('course_unavailable', 409);
    return { courses: courses.rows.map(function includeQuestions(course) {
        return { id: course.id, code: course.code, title: course.title, fee: course.fee, payment_deadline: course.payment_deadline.toISOString(),
            sessions: course.sessions, definition: banks.rows.find(function match(bank) { return bank.course_id === course.id; }).definition };
    }), total: courses.rows.reduce(function sum(total, course) { return total + course.fee; }, 0),
        payment_deadline: new Date(Math.min(...courses.rows.map(function deadline(course) { return course.payment_deadline.getTime(); }))).toISOString() };
}

async function receipt(client, session) {
    const result = await client.query(
        `SELECT reference, salutation, full_name, organisation, job_title, phone, email,
                comments, total, created_at FROM submission WHERE id = $1`, [session.submission_id]);
    if (!result.rowCount) fail('application_not_found', 404);
    const registrations = await client.query('SELECT id, course_id, fee, answers FROM registration WHERE submission_id = $1 ORDER BY course_id', [session.submission_id]);
    return { submission: result.rows[0], acknowledgement_email: await acknowledgement.status(client, session.submission_id),
        payment: await payment.forSubmission(client, session.submission_id, true),
        registrations: registrations.rows.map(function details(registration) {
        const course = session.definition.courses.find(function match(course) { return course.id === registration.course_id; });
        return { ...registration, code: course.code, title: course.title, definition: course.definition };
    }) };
}

router.post('/definition', async function applicationDefinition(req, res, next) {
    try {
        exactKeys(req.body, ['course_ids']);
        const ids = courseIds(req.body.course_ids);
        const result = await transaction(req, res, true, async function prepare(client, session) {
            if (session.submission_id) fail('application_completed', 409);
            const definition = await definitionFor(client, ids);
            if (!session.definition || fingerprint(session.definition) !== fingerprint(definition)) {
                session.definition = definition;
                session.review_token = crypto.randomBytes(24).toString('base64url');
            }
            return { body: { definition, review_token: session.review_token } };
        });
        res.json(result.body);
    } catch (error) { next(error); }
});

router.post('/', async function submitApplication(req, res, next) {
    try {
        const result = await transaction(req, res, false, async function submit(client, session) {
            if (!session.definition) fail('application_expired', 401);
            const application = validateApplication(req.body, session.definition);
            const hash = fingerprint(application);
            if (session.submission_id) {
                if (hash !== session.payload_hash) fail('application_completed', 409);
                return { body: { receipt: await receipt(client, session), repeated: true } };
            }
            if (application.review_token !== session.review_token) fail('definition_changed', 409);
            const ids = session.definition.courses.map(function id(course) { return course.id; });
            const current = await definitionFor(client, ids);
            if (fingerprint(current) !== fingerprint(session.definition)) fail('definition_changed', 409);
            const personal = application.personal;
            const month = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
            const period = month.find(function year(part) { return part.type === 'year'; }).value + month.find(function number(part) { return part.type === 'month'; }).value;
            const reference = `APP-${period}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
            const inserted = await client.query(
                `INSERT INTO submission (reference, salutation, full_name, organisation, job_title,
                    phone, email, comments, consent_accepted, total)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9) RETURNING id`,
                [reference, personal.salutation, personal.full_name, personal.organisation, personal.job_title,
                    personal.phone, personal.email, personal.comments || null, current.total]);
            session.submission_id = inserted.rows[0].id;
            for (const course of current.courses) {
                const registration = await client.query(
                    `INSERT INTO registration (submission_id, course_id, fee, answers)
                     VALUES ($1,$2,$3,$4) RETURNING id`,
                    [session.submission_id, course.id, course.fee, application.answers[course.id]]);
                await writeLog(client, { actorType: 'participant', event: 'registration.created', courseId: course.id,
                    submissionId: session.submission_id, registrationId: registration.rows[0].id });
            }
            await payment.createPending(client, session.submission_id);
            await writeLog(client, { actorType: 'participant', event: 'application.submitted', submissionId: session.submission_id,
                details: { registrations: current.courses.length } });
            await acknowledgement.request(client, session.submission_id);
            session.payload_hash = hash;
            return { status: 201, submissionId: session.submission_id,
                body: { receipt: await receipt(client, session), repeated: false } };
        });
        if (result.status === 201) {
            try {
                result.body.receipt.acknowledgement_email = await acknowledgement.send(result.submissionId);
            } catch {
                // The application is already committed. Mail preparation must not turn it into a failed submission.
                console.error('Acknowledgement attempt could not start for submission', result.submissionId);
                result.body.receipt.acknowledgement_email = { status: 'uncertain', updated_at: null };
            }
        }
        res.status(result.status || 200).json(result.body);
    } catch (error) { next(error); }
});

router.get('/result', async function applicationResult(req, res, next) {
    try {
        const result = await transaction(req, res, false, async function read(client, session) {
            // Recovery is limited to the active form, whose review token stays in memory.
            // The application cookie alone must not reopen a completed acknowledgement.
            if (!session.submission_id || !session.review_token || req.get('X-Application-Review') !== session.review_token) {
                fail('application_not_found', 404);
            }
            return { body: { receipt: await receipt(client, session) } };
        });
        res.json(result.body);
    } catch (error) { next(error); }
});

router.post('/new', async function newApplication(req, res, next) {
    try {
        exactKeys(req.body, []);
        await readySessionTable();
        const token = browserToken(req);
        if (token) await pool.query('DELETE FROM session WHERE sid = $1', [`application:${token}`]);
        res.clearCookie(cookieName, cookieOptions);
        res.json({ message: 'A new application can be started.' });
    } catch (error) { next(error); }
});

router.use(function applicationError(error, req, res, next) {
    if (error.status) return res.status(error.status).json({ code: error.code });
    if (error.code === '55P03' || error.code === '40P01') return res.status(409).json({ code: 'application_busy' });
    next(error);
});

module.exports = router;
