const express = require('express');
const pool = require('./db');
const router = express.Router();

const actions = {};
function action(event, group, outcome = 'recorded') { actions[event] = { action: event.replaceAll('.', '_'), group, outcome }; }
for (const event of ['login_succeeded', 'logout_succeeded', 'login_failed', 'session_invalid']) action(`admin.${event}`, 'access', ['login_failed', 'session_invalid'].includes(event) ? 'failed' : 'recorded');
for (const event of ['application.submitted', 'registration.created']) action(event, 'applications');
for (const event of ['created', 'published', 'archived', 'questions_saved', 'certificate_template_saved', 'fee_updated', 'wording_updated']) action(`course.${event}`, 'courses');
for (const event of ['created', 'completed', 'paid', 'expired', 'cancelled', 'rejected', 'failed']) action(`payment.${event}`, 'payments', ['rejected', 'failed'].includes(event) ? 'failed' : 'recorded');
for (const event of ['opened', 'recorded', 'corrected', 'format_updated']) action(`attendance.${event}`, 'attendance');
action('certificate.issued', 'certificates');
action('development.registrations_seeded', 'system');
for (const prefix of ['acknowledgement', 'attendance.email', 'certificate.email', 'attendance.result.email']) {
    for (const outcome of ['requested', 'started', 'accepted', 'failed', 'uncertain']) action(`${prefix}.${outcome}`, 'email', outcome);
}

function fail() { throw Object.assign(new Error('Invalid activity filters.'), { status: 400 }); }
function integer(value) { return Number.isInteger(value) && value > 0 && value <= 2147483647; }
function date(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function time(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)); }

function filters(query) {
    if (Object.keys(query).some(key => !['group', 'actor', 'from', 'to', 'q', 'cursor'].includes(key) || typeof query[key] !== 'string') ||
        (query.group && ![...new Set(Object.values(actions).map(item => item.group)), 'other'].includes(query.group)) ||
        (query.actor && !['admin', 'participant', 'system'].includes(query.actor)) ||
        (query.from && !date(query.from)) || (query.to && !date(query.to)) ||
        (query.from && query.to && query.from > query.to) || (query.q && query.q.length > 100)) fail();
    let cursor;
    if (query.cursor) {
        try {
            if (query.cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) fail();
            cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
            if (!cursor || Object.keys(cursor).sort().join(',') !== 'at,id' || !time(cursor.at) || !integer(cursor.id)) fail();
        } catch { fail(); }
    }
    return { ...query, q: query.q?.trim() || '', cursor };
}

function summary(row) {
    const result = {};
    if (/^[a-z][a-z0-9_]{0,99}$/.test(row.session_id || '')) result.session_id = row.session_id;
    for (const key of ['recorded_at', 'before_at', 'after_at', 'closes_at']) if (time(row[key])) result[key] = row[key];
    for (const key of ['question_count', 'registration_count']) if (row[key] !== null && Number.isInteger(Number(row[key])) && Number(row[key]) >= 0 && Number(row[key]) <= 100000) result[key] = Number(row[key]);
    if (/^CERT-\d{4}-\d+$/.test(row.certificate_number || '')) result.certificate_number = row.certificate_number;
    return result;
}

router.get('/activity', async function list(req, res) {
    try {
        const filter = filters(req.query);
        const conditions = [];
        const values = [];
        function add(sql, value) { values.push(value); conditions.push(sql.replace('?', `$${values.length}`)); }
        if (filter.group) add(filter.group === 'other' ? 'NOT(l.event=ANY(?::text[]))' : 'l.event=ANY(?::text[])',
            Object.keys(actions).filter(event => filter.group === 'other' || actions[event].group === filter.group));
        if (filter.actor) add('l.actor_type=?', filter.actor);
        if (filter.from) add("l.created_at >= (?::date::timestamp AT TIME ZONE 'Asia/Hong_Kong')", filter.from);
        if (filter.to) add("l.created_at < ((?::date+1)::timestamp AT TIME ZONE 'Asia/Hong_Kong')", filter.to);
        if (filter.q) {
            const position = values.push(`%${filter.q.replace(/[\\%_]/g, '\\$&')}%`);
            conditions.push(`(c.code ILIKE $${position} OR s.reference ILIKE $${position} OR p.reference ILIKE $${position} OR l.registration_id::text ILIKE $${position})`);
        }
        if (filter.cursor) {
            values.push(filter.cursor.at, filter.cursor.id);
            conditions.push(`(l.created_at,l.id)<($${values.length - 1}::timestamptz,$${values.length}::integer)`);
        }
        const result = await pool.query(`SELECT l.id,l.created_at,l.event,l.actor_type,a.username,
            l.course_id,c.code AS course_code,l.submission_id,s.reference AS application_reference,
            l.registration_id,l.payment_id,p.reference AS payment_reference,
            to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
            l.details->>'session_id' AS session_id,l.details->>'recorded_at' AS recorded_at,
            l.details->'before'->>'recorded_at' AS before_at,l.details->'after'->>'recorded_at' AS after_at,
            l.details->>'closes_at' AS closes_at,l.details->>'certificate_number' AS certificate_number,
            CASE WHEN jsonb_typeof(l.details->'question_count')='number' AND length(l.details->>'question_count')<7 THEN (l.details->>'question_count')::numeric ELSE NULL END AS question_count,
            CASE WHEN jsonb_typeof(l.details->'registrations')='array' THEN jsonb_array_length(l.details->'registrations') ELSE NULL END AS registration_count
            FROM log l LEFT JOIN admin a ON a.id=l.admin_id LEFT JOIN course c ON c.id=l.course_id
            LEFT JOIN submission s ON s.id=l.submission_id LEFT JOIN payment p ON p.id=l.payment_id
            ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY l.created_at DESC,l.id DESC LIMIT 26`, values);
        const rows = result.rows.slice(0, 25);
        const last = rows.at(-1);
        res.json({ records: rows.map(row => ({ id: row.id, created_at: row.created_at,
            ...(actions[row.event] || { action: 'other', group: 'other', outcome: 'recorded' }),
            actor: { type: row.actor_type, username: row.username },
            related: { course_id: row.course_id, course_code: row.course_code, application_reference: row.application_reference,
                registration_id: row.registration_id, payment_reference: row.payment_reference }, summary: summary(row) })),
            next_cursor: result.rows.length > 25 ? Buffer.from(JSON.stringify({ at: last.cursor_time, id: last.id })).toString('base64url') : null });
    } catch (error) {
        if (!error.status) console.error('Activity records could not be read.');
        res.status(error.status || 503).json({ code: error.status ? 'activity_invalid_filters' : 'activity_unavailable' });
    }
});

module.exports = router;
module.exports.actions = actions;
