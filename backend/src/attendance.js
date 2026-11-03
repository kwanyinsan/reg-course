const express = require('express');
const pool = require('./db');
const writeLog = require('./log');
const access = require('./attendance-access');

const router = express.Router();

function exact(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

async function transaction(operation) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='5s'");
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}

async function courseSession(database, courseId, sessionId, lock = '') {
    const result = await database.query(`SELECT id,code,title,state,published_at,sessions,attendance_requirement_percent,clock_timestamp() AS server_time FROM course WHERE id=$1 ${lock}`, [courseId]);
    const course = result.rows[0];
    const session = course?.sessions.find(item => item.id === sessionId);
    if (!session) access.fail('attendance_session_missing', 404);
    return { course, session };
}

function roundView(row) {
    return row ? { id: row.id, course_id: row.course_id, session_id: row.details.session_id, opened_at: row.created_at,
        closes_at: row.details.closes_at, registration_ids: row.details.registration_ids } : null;
}

async function roundFor(database, courseId, sessionId) {
    const result = await database.query("SELECT id,course_id,created_at,details FROM log WHERE course_id=$1 AND event='attendance.opened' AND details->>'session_id'=$2 ORDER BY id DESC LIMIT 1", [courseId, sessionId]);
    return roundView(result.rows[0]);
}

function percentage(registration, course, now = Date.now()) {
    const completed = course.sessions.filter(item => registration.attendance[item.id]?.attended === true).length;
    const total = course.sessions.length;
    return { completed, total, percent: completed * 100 / total, required: Number(course.attendance_requirement_percent),
        meets_requirement: completed * 100 >= Number(course.attendance_requirement_percent) * total,
        provisional: course.sessions.some(item => new Date(item.ends_at).getTime() > now) };
}

async function open(courseId, sessionId, adminId) {
    access.configuration();
    return transaction(async function start(client) {
        const { course, session } = await courseSession(client, courseId, sessionId, 'FOR UPDATE');
        if (course.state !== 'published') access.fail('attendance_unavailable', 409);
        const existing = await roundFor(client, courseId, sessionId);
        if (existing) return { round: existing, repeated: true };
        const now = course.server_time.getTime();
        if (now < new Date(session.starts_at).getTime() - 900000 || now >= new Date(session.ends_at).getTime()) access.fail('attendance_start_window', 409);
        const registrations = await client.query(`SELECT r.id FROM registration r JOIN submission s ON s.id=r.submission_id
            WHERE r.course_id=$1 AND r.state='registered' AND NOT s.is_cancelled AND r.certificate_number IS NULL ORDER BY r.id`, [courseId]);
        const details = { session_id: sessionId, closes_at: new Date(Math.min(now + 1800000, new Date(session.ends_at).getTime())).toISOString(),
            registration_ids: registrations.rows.map(row => row.id) };
        const saved = await client.query(`INSERT INTO log(actor_type,admin_id,event,course_id,details)
            VALUES('admin',$1,'attendance.opened',$2,$3) RETURNING id,course_id,created_at,details`, [adminId, courseId, details]);
        return { round: roundView(saved.rows[0]), repeated: false };
    });
}

async function registration(database, id, courseId, lock = false) {
    if (lock) {
        const found = await database.query('SELECT submission_id FROM registration WHERE id=$1', [id]);
        if (!found.rowCount) access.fail('attendance_link_invalid', 401);
        await database.query('SELECT id FROM submission WHERE id=$1 FOR UPDATE', [found.rows[0].submission_id]);
        await database.query('SELECT id FROM course WHERE id=$1 FOR SHARE', [courseId]);
    }
    const result = await database.query(`SELECT r.id,r.submission_id,r.course_id,r.state,r.attendance,r.certificate_number,
        s.full_name,s.email,s.reference,s.is_cancelled FROM registration r JOIN submission s ON s.id=r.submission_id
        WHERE r.id=$1 ${lock ? 'FOR UPDATE OF r' : ''}`, [id]);
    const row = result.rows[0];
    if (!row || row.course_id !== courseId) access.fail('attendance_link_invalid', 401);
    return row;
}

function eligible(row, course) {
    if (row.state !== 'registered' || row.is_cancelled) access.fail('attendance_cancelled', 409);
    if (row.certificate_number) access.fail('attendance_certificate_locked', 409);
    if (course.state !== 'published') access.fail('attendance_unavailable', 409);
}

async function context(database, claims, lock = false) {
    const row = await registration(database, claims.registration_id, claims.course_id, lock);
    const { course, session } = await courseSession(database, claims.course_id, claims.session_id);
    eligible(row, course);
    const round = await roundFor(database, claims.course_id, claims.session_id);
    if (!round || round.id !== claims.round_id || !round.registration_ids.includes(row.id) || claims.expires_at !== new Date(round.closes_at).getTime()) access.fail('attendance_link_invalid', 401);
    if (course.server_time.getTime() >= new Date(round.closes_at).getTime()) access.fail('attendance_link_expired', 410);
    return { row, course, session, round };
}

function participantView(data) {
    return { participant_name: data.row.full_name, course: { code: data.course.code, title: data.course.title }, session: data.session,
        closes_at: data.round.closes_at, server_time: data.course.server_time, entry: data.row.attendance[data.session.id] || null };
}

async function record(claims, qr) {
    if (qr.round_id !== claims.round_id || qr.course_id !== claims.course_id || qr.session_id !== claims.session_id) access.fail('attendance_wrong_session', 409);
    return transaction(async function save(client) {
        const data = await context(client, claims, true);
        const now = data.course.server_time.getTime();
        if (now >= qr.expires_at || qr.expires_at > new Date(data.round.closes_at).getTime()) access.fail('attendance_qr_expired', 410);
        const original = data.row.attendance[data.session.id];
        if (original) return { ...participantView(data), repeated: true };
        const saved = await client.query(`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS at)
            UPDATE registration r SET attendance=jsonb_set(r.attendance,ARRAY[$2]::text[],jsonb_build_object('recorded_at',moment.at,'attended',true),true)
            FROM moment WHERE r.id=$1 AND moment.at<$3::timestamptz AND moment.at<to_timestamp($4::double precision/1000)
            RETURNING r.attendance->$2 AS entry`, [data.row.id, data.session.id, data.round.closes_at, qr.expires_at]);
        if (!saved.rowCount) access.fail('attendance_closed', 410);
        const entry = saved.rows[0].entry;
        await writeLog(client, { actorType: 'participant', event: 'attendance.recorded', courseId: data.course.id,
            submissionId: data.row.submission_id, registrationId: data.row.id, details: { session_id: data.session.id, round_id: data.round.id, recorded_at: entry.recorded_at } });
        data.row.attendance[data.session.id] = entry;
        return { ...participantView(data), repeated: false };
    });
}

async function correct(id, courseId, sessionId, body, adminId) {
    if (!exact(body, ['recorded_at', 'original_entry', 'reason']) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500 ||
        (body.original_entry !== null && !validEntry(body.original_entry))) access.fail('invalid_request');
    if (body.recorded_at !== null && (!validTime(body.recorded_at) || new Date(body.recorded_at).getTime() > Date.now())) access.fail('attendance_invalid_time');
    return transaction(async function save(client) {
        const row = await registration(client, id, courseId, true);
        const { course, session } = await courseSession(client, courseId, sessionId);
        if (!course.published_at) access.fail('attendance_unavailable', 409);
        if (row.certificate_number) access.fail('attendance_certificate_locked', 409);
        const valid = await client.query('SELECT $1::text IS NULL OR valid_offset_time($1::text) AS valid', [body.recorded_at]);
        if (!valid.rows[0].valid) access.fail('attendance_invalid_time');
        if (body.recorded_at && new Date(body.recorded_at) > course.server_time) access.fail('attendance_invalid_time');
        if (body.recorded_at && (new Date(body.recorded_at).getTime() < new Date(session.starts_at).getTime() - 900000 || new Date(body.recorded_at) > new Date(session.ends_at))) access.fail('attendance_invalid_time');
        const before = row.attendance[sessionId] || null;
        const after = body.recorded_at ? { recorded_at: new Date(body.recorded_at).toISOString(), attended: true } : null;
        const comparison = await client.query('SELECT $1::jsonb IS NOT DISTINCT FROM $2::jsonb AS matches,$1::jsonb IS NOT DISTINCT FROM $3::jsonb AS unchanged', [before, body.original_entry, after]);
        if (!comparison.rows[0].matches && !comparison.rows[0].unchanged) access.fail('attendance_conflict', 409);
        if (!comparison.rows[0].unchanged) {
            if (after) await client.query('UPDATE registration SET attendance=jsonb_set(attendance,ARRAY[$2]::text[],$3::jsonb,true) WHERE id=$1', [id, sessionId, after]);
            else await client.query('UPDATE registration SET attendance=attendance-$2 WHERE id=$1', [id, sessionId]);
            await writeLog(client, { actorType: 'admin', adminId, event: 'attendance.corrected', courseId,
                submissionId: row.submission_id, registrationId: id, details: { session_id: sessionId, reason: body.reason.trim(), before, after } });
        }
        return { entry: after };
    });
}

function validTime(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(new Date(value).getTime());
}

function validEntry(value) { return exact(value, ['recorded_at', 'attended']) && value.attended === true && validTime(value.recorded_at); }

function errorHandler(error, req, res, next) {
    void next;
    if (error.status) return res.status(error.status).json({ code: error.code });
    if (['55P03', '40P01'].includes(error.code)) return res.status(409).json({ code: 'attendance_busy' });
    console.error('Attendance request could not be completed.');
    res.status(503).json({ code: 'attendance_unavailable' });
}

const attempts = new Map();
router.use(function protect(req, res, next) {
    try {
        if (Object.keys(req.query).length) access.fail('invalid_request');
        const now = Date.now();
        for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
        let entry = attempts.get(req.ip);
        if (!entry) { if (attempts.size >= 10000) access.fail('attendance_limit', 429); entry = { count: 0, until: now + 60000 }; attempts.set(req.ip, entry); }
        if (++entry.count > 90) access.fail('attendance_limit', 429);
        const auth = req.get('Authorization');
        if (!auth?.startsWith('Bearer ')) access.fail('attendance_link_invalid', 401);
        req.attendanceAccess = access.verify(auth.slice(7), 'attendance_student');
        next();
    } catch (error) { next(error); }
});
router.get('/', async function read(req, res, next) {
    try { res.json(participantView(await context(pool, req.attendanceAccess))); } catch (error) { next(error); }
});
router.post('/record', async function scan(req, res, next) {
    try {
        if (!exact(req.body, ['qr_token'])) access.fail('invalid_request');
        res.json(await record(req.attendanceAccess, access.verify(req.body.qr_token, 'attendance_qr')));
    } catch (error) { next(error); }
});
router.use(errorHandler);

module.exports = { router, exact, transaction, courseSession, roundFor, percentage, open, registration, eligible, context, record, correct, validEntry, errorHandler };
