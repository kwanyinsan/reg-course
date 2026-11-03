const express = require('express');
const pool = require('./db');
const writeLog = require('./log');
const access = require('./payment-access');

const router = express.Router();
const stateSql = `CASE WHEN p.state='paid' THEN 'paid'
    WHEN p.id IS NULL THEN NULL
    WHEN p.state='cancelled' OR s.is_cancelled THEN 'cancelled'
    WHEN p.state='expired' OR (p.state='pending' AND p.due_at<=transaction_timestamp()) THEN 'expired'
    ELSE p.state END`;
const unavailableSql = `CASE WHEN p.state='pending' AND NOT s.is_cancelled AND p.due_at>transaction_timestamp() THEN
    CASE WHEN EXISTS(SELECT 1 FROM registration cancelled WHERE cancelled.submission_id=s.id AND cancelled.state='cancelled') THEN 'course_cancelled'
    WHEN p.amount<>s.total OR p.amount<>(SELECT SUM(charges.fee) FROM registration charges WHERE charges.submission_id=s.id) THEN 'amount_mismatch' END END`;

function fail(code, status) {
    throw Object.assign(new Error('Payment request could not be completed.'), { code, status });
}

async function createPending(database, submissionId) {
    const result = await database.query(
        `SELECT s.reference,s.total::text,COUNT(r.id)::int AS registrations,
                s.total=SUM(r.fee) AS amounts_match,MIN(c.payment_deadline) AS due_at
         FROM submission s JOIN registration r ON r.submission_id=s.id JOIN course c ON c.id=r.course_id
         WHERE s.id=$1 GROUP BY s.id`, [submissionId]);
    const saved = result.rows[0];
    if (!saved || !saved.amounts_match || saved.registrations < 1 || saved.registrations > 10) fail('payment_unavailable', 409);
    if (Number(saved.total) === 0) return;
    access.configuration();
    const inserted = await database.query(
        `INSERT INTO payment(submission_id,reference,amount,due_at)
         SELECT $1,$2,$3,$4::timestamptz WHERE $4::timestamptz>clock_timestamp() RETURNING id`,
        [submissionId, saved.reference.replace(/^APP-/, 'PAY-'), saved.total, saved.due_at]);
    if (!inserted.rowCount) fail('course_unavailable', 409);
    await writeLog(database, { actorType: 'participant', event: 'payment.created', submissionId,
        paymentId: inserted.rows[0].id, details: { amount: saved.total, due_at: saved.due_at } });
}

async function readPayment(database, submissionId) {
    const result = await database.query(
        `SELECT p.id,p.submission_id,p.reference,p.amount::text,p.due_at,p.state,p.paid_at,p.created_at,
                s.reference AS application_reference,s.total::text,s.is_cancelled,clock_timestamp() AS server_time,
                EXISTS(SELECT 1 FROM registration r WHERE r.submission_id=s.id AND r.state='cancelled') AS course_cancelled,
                p.amount=s.total AND p.amount=(SELECT SUM(r.fee) FROM registration r WHERE r.submission_id=s.id) AS amounts_match
         FROM submission s LEFT JOIN payment p ON p.submission_id=s.id WHERE s.id=$1`, [submissionId]);
    if (!result.rowCount) fail('payment_unavailable', 404);
    return result.rows[0];
}

function paymentView(record, includeLink = false) {
    let state = record.state;
    let reason = null;
    if (!record.id) state = Number(record.total) === 0 ? 'not_required' : 'unavailable';
    else if (state !== 'paid') {
        if (state === 'cancelled' || record.is_cancelled) state = 'cancelled';
        else if (state === 'expired' || new Date(record.server_time) >= new Date(record.due_at)) state = 'expired';
        else if (record.course_cancelled) reason = 'course_cancelled';
        else if (!record.amounts_match) reason = 'amount_mismatch';
    }
    const view = { application_reference: record.application_reference, reference: record.reference || null,
        amount: record.amount || record.total, due_at: record.due_at || null, state, paid_at: record.paid_at || null,
        can_pay: state === 'pending' && !reason, unavailable_reason: reason, server_time: record.server_time };
    if (includeLink) view.access_url = record.id ? access.accessLink(record) : null;
    return view;
}

async function forSubmission(database, submissionId, includeLink = false) {
    return paymentView(await readPayment(database, submissionId), includeLink);
}

async function selectedCourses(database, submissionId) {
    const result = await database.query(
        `SELECT c.code,c.title,c.sessions,r.fee::text FROM registration r JOIN course c ON c.id=r.course_id
         WHERE r.submission_id=$1 ORDER BY r.course_id`, [submissionId]);
    return result.rows;
}

async function viewPayment(claims) {
    const found = await pool.query('SELECT submission_id FROM payment WHERE id=$1', [claims.payment_id]);
    if (!found.rowCount) fail('payment_link_invalid', 401);
    const record = await readPayment(pool, found.rows[0].submission_id);
    access.validatePayment(claims, record);
    return { ...paymentView(record), courses: await selectedCourses(pool, record.submission_id) };
}

async function payPayment(claims) {
    const client = await pool.connect();
    let submissionId;
    let committed = false;
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='5s'");
        const found = await client.query('SELECT id FROM submission WHERE id=(SELECT submission_id FROM payment WHERE id=$1) FOR UPDATE', [claims.payment_id]);
        if (!found.rowCount) fail('payment_link_invalid', 401);
        submissionId = found.rows[0].id;
        await client.query('SELECT id FROM payment WHERE id=$1 FOR UPDATE', [claims.payment_id]);
        await client.query('SELECT id FROM registration WHERE submission_id=$1 ORDER BY id FOR UPDATE', [submissionId]);
        const record = await readPayment(client, submissionId);
        access.validatePayment(claims, record);
        const current = paymentView(record);
        const repeated = current.state === 'paid';
        let status = 200;
        if (!repeated) {
            if (current.state !== 'pending' || !current.can_pay) {
                status = 409;
                if (record.state === 'pending' && ['expired', 'cancelled'].includes(current.state)) {
                    await client.query('UPDATE payment SET state=$2 WHERE id=$1', [record.id, current.state]);
                    await writeLog(client, { actorType: 'participant', event: `payment.${current.state}`, submissionId, paymentId: record.id });
                } else {
                    await writeLog(client, { actorType: 'participant', event: 'payment.rejected', submissionId, paymentId: record.id,
                        details: { reason: current.unavailable_reason || current.state } });
                }
            } else {
                const paid = await client.query(
                    `WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS at)
                     UPDATE payment p SET state='paid',paid_at=moment.at FROM moment
                     WHERE p.id=$1 AND p.state='pending' AND p.due_at>moment.at RETURNING p.paid_at`, [record.id]);
                if (paid.rowCount) {
                    await writeLog(client, { actorType: 'participant', event: 'payment.completed', submissionId, paymentId: record.id,
                        details: { amount: record.amount, method: 'website' } });
                } else {
                    status = 409;
                    await client.query("UPDATE payment SET state='expired' WHERE id=$1", [record.id]);
                    await writeLog(client, { actorType: 'participant', event: 'payment.expired', submissionId, paymentId: record.id });
                }
            }
        }
        const payment = { ...await forSubmission(client, submissionId), courses: await selectedCourses(client, submissionId) };
        await client.query('COMMIT');
        committed = true;
        return { status, body: { payment, repeated } };
    } catch (error) {
        if (!committed) await client.query('ROLLBACK');
        if (submissionId && !error.status) {
            try { await writeLog(pool, { actorType: 'system', event: 'payment.failed', submissionId,
                paymentId: claims.payment_id, details: { reason: 'database_failure' } }); }
            catch { console.error('Payment failure could not be recorded.'); }
        }
        throw error;
    } finally { client.release(); }
}

const attempts = new Map();
router.use(function paymentAccess(req, res, next) {
    try {
        if (Object.keys(req.query).length) fail('invalid_request', 400);
        const now = Date.now();
        for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
        let entry = attempts.get(req.ip);
        if (!entry) {
            if (attempts.size >= 10000) fail('too_many_requests', 429);
            entry = { until: now + 15 * 60 * 1000, count: 0 };
            attempts.set(req.ip, entry);
        }
        if (++entry.count > 120) fail('too_many_requests', 429);
        const authorization = req.get('Authorization');
        if (!authorization?.startsWith('Bearer ')) fail('payment_link_invalid', 401);
        req.paymentAccess = access.verifyAccess(authorization.slice(7));
        next();
    } catch (error) { next(error); }
});

router.get('/', async function getPayment(req, res, next) {
    try { res.json({ payment: await viewPayment(req.paymentAccess) }); }
    catch (error) { next(error); }
});

router.post('/pay', async function recordPayment(req, res, next) {
    try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) fail('invalid_request', 400);
        const result = await payPayment(req.paymentAccess);
        res.status(result.status).json(result.body);
    } catch (error) { next(error); }
});

router.use(function paymentError(error, req, res, next) {
    void next;
    if (error.status) return res.status(error.status).json({ code: error.code });
    if (['55P03', '40P01'].includes(error.code)) return res.status(409).json({ code: 'payment_busy' });
    console.error('Payment request could not be completed.');
    res.status(503).json({ code: 'payment_unavailable' });
});

module.exports = { router, stateSql, unavailableSql, createPending, forSubmission, readPayment, paymentView, payPayment };
