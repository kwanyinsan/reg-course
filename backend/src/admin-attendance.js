const express = require('express');
const QRCode = require('qrcode');
const pool = require('./db');
const attendance = require('./attendance');
const access = require('./attendance-access');
const mail = require('./attendance-mail');
const payments = require('./payment');
const router = express.Router();

function parameters(req) {
    if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647 ||
        !/^[a-z][a-z0-9_]{0,99}$/.test(req.params.sessionId) || Object.keys(req.query).length) access.fail('invalid_request');
    return [Number(req.params.id), req.params.sessionId];
}

router.get('/courses/:id/attendance/:sessionId', async function list(req, res, next) {
    try {
        const [id, sessionId] = parameters(req);
        const { course, session } = await attendance.courseSession(pool, id, sessionId);
        const round = await attendance.roundFor(pool, id, sessionId);
        const states = round ? await mail.statuses(pool, round.id) : new Map();
        const result = await pool.query(`SELECT r.id,r.submission_id,r.state,r.attendance,r.certificate_number,s.reference,s.full_name,s.email,s.is_cancelled,
            CASE WHEN p.id IS NULL AND s.total=0 THEN 'not_required' ELSE ${payments.stateSql} END AS payment_state FROM registration r JOIN submission s ON s.id=r.submission_id
            LEFT JOIN payment p ON p.submission_id=s.id WHERE r.course_id=$1 ORDER BY s.full_name,r.id`, [id]);
        const participants = result.rows.map(function participant(row) {
            const eligible = course.state === 'published' && row.state === 'registered' && !row.is_cancelled && !row.certificate_number;
            return { id: row.id, reference: row.reference, full_name: row.full_name, email: row.email,
                cancelled: row.state === 'cancelled' || row.is_cancelled, certificate_locked: Boolean(row.certificate_number),
                entry: row.attendance[sessionId] || null, percentage: attendance.percentage(row, course), payment_state: row.payment_state,
                email_status: mail.excluded(row.email) ? 'excluded' : states.get(row.id)?.status || 'not_requested',
                email_eligible: eligible && !mail.excluded(row.email) && Boolean(round?.registration_ids.includes(row.id)) };
        });
        const now = course.server_time.getTime();
        res.json({ course: { id: course.id, code: course.code, title: course.title, published_at: course.published_at }, session, round,
            server_time: course.server_time, can_start: !round && course.state === 'published' && now >= new Date(session.starts_at).getTime() - 900000 && now < new Date(session.ends_at).getTime(),
            participants });
    } catch (error) { next(error); }
});
router.post('/courses/:id/attendance/:sessionId/start', async function start(req, res, next) {
    try {
        if (!attendance.exact(req.body, [])) access.fail('invalid_request');
        res.json(await attendance.open(...parameters(req), req.admin.id));
    } catch (error) { next(error); }
});
router.get('/courses/:id/attendance/:sessionId/qr', async function qr(req, res, next) {
    try {
        const [id, sessionId] = parameters(req);
        const { course, session } = await attendance.courseSession(pool, id, sessionId);
        const round = await attendance.roundFor(pool, id, sessionId);
        if (!round || course.state !== 'published' || course.server_time >= new Date(round.closes_at)) access.fail('attendance_closed', 410);
        const token = access.sign('attendance_qr', round, null, course.server_time.getTime());
        const expires = Math.min(new Date(round.closes_at).getTime(), course.server_time.getTime() + 90000);
        const image = await QRCode.toDataURL(`reg-course-attendance:${token}`, { errorCorrectionLevel: 'M', margin: 4, width: 720 });
        res.json({ course: { code: course.code, title: course.title }, session, image, expires_at: new Date(expires).toISOString(), closes_at: round.closes_at, server_time: course.server_time });
    } catch (error) { next(error); }
});
router.post('/courses/:id/attendance/:sessionId/email', async function send(req, res, next) {
    try {
        const [id, sessionId] = parameters(req);
        if (!attendance.exact(req.body, ['registration_id', 'retry']) || !Number.isInteger(req.body.registration_id) || req.body.registration_id < 1 || req.body.registration_id > 2147483647 || typeof req.body.retry !== 'boolean') access.fail('invalid_request');
        res.json(await mail.send(id, sessionId, req.body.registration_id, req.body.retry, req.admin.id));
    } catch (error) { next(error); }
});
router.put('/registrations/:id/attendance/:sessionId', async function correct(req, res, next) {
    try {
        const [id, sessionId] = parameters(req);
        const found = await pool.query('SELECT course_id FROM registration WHERE id=$1', [id]);
        if (!found.rowCount) access.fail('attendance_session_missing', 404);
        res.json(await attendance.correct(id, found.rows[0].course_id, sessionId, req.body, req.admin.id));
    } catch (error) { next(error); }
});
router.use(attendance.errorHandler);
module.exports = router;
