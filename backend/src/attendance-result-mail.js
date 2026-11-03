const crypto = require('node:crypto');
const pool = require('./db');
const writeLog = require('./log');
const attendance = require('./attendance');
const access = require('./attendance-access');
const mail = require('./mail');

const event = 'attendance.result';
const prefix = 'attendance.result.email.';
const subject = '{{message_heading}} — {{course_code}} — {{session_title}}';
const body = `Dear {{participant_name}},

{{introduction}}

Course: {{course_title}}
Course code: {{course_code}}
Session: {{session_title}}
Session time: {{session_time}} — Hong Kong time

Result: {{result}}
{{recorded_time}}

This message reports your attendance record for this session only.

If you believe this record is missing or incorrect, please contact the course administrator.`;

function entry(value) { return value ? { recorded_at: value.recorded_at, attended: true } : null; }
function same(left, right) { return JSON.stringify(entry(left)) === JSON.stringify(entry(right)); }
function recipient(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s@,;:<>"()\[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value) && !/@(?:[^@]*\.)?(?:invalid|test|localhost)$/i.test(value); }
function date(value) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)); }
function escape(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }

function validSnapshot(value) {
    return value && ['participant_name', 'recipient', 'course_code', 'course_title', 'session_title', 'starts_at', 'ends_at'].every(key => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 4000) &&
        recipient(value.recipient) && Number.isFinite(Date.parse(value.starts_at)) && Number.isFinite(Date.parse(value.ends_at)) &&
        (value.entry === null || attendance.validEntry(value.entry)) && typeof value.is_update === 'boolean';
}

function render(template, snapshot) {
    if (!validSnapshot(snapshot)) throw Object.assign(new Error('Invalid result snapshot.'), { code: 'MAIL_TEMPLATE' });
    const heading = snapshot.is_update ? 'Updated attendance result' : 'Attendance result';
    const values = { ...snapshot, message_heading: heading,
        introduction: snapshot.is_update ? 'This message contains an updated attendance record for this session.' : 'Your attendance record for the following session is shown below.',
        session_time: `${date(snapshot.starts_at)} – ${date(snapshot.ends_at)}`,
        result: snapshot.entry ? 'Attendance recorded' : 'No attendance recorded',
        recorded_time: snapshot.entry ? `Recorded time: ${date(snapshot.entry.recorded_at)} — Hong Kong time` : 'No attendance record is currently saved for you for this session.' };
    function replace(value, html = false) {
        return value.replace(/{{([^{}]+)}}/g, function placeholder(match, key) {
            if (!Object.hasOwn(values, key) || typeof values[key] !== 'string') throw Object.assign(new Error('Invalid result template.'), { code: 'MAIL_TEMPLATE' });
            return html ? escape(values[key]) : values[key];
        });
    }
    const paragraphs = template.body.split(/\n\s*\n/).map(value => `<p style="line-height:1.6">${replace(value, true).replace(/\n/g, '<br>')}</p>`).join('');
    return { subject: replace(template.subject).replace(/[\r\n]+/g, ' '), text: replace(template.body),
        html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f5;color:#222;font-family:Arial,sans-serif"><div style="max-width:640px;margin:24px auto;padding:24px;background:#fff;border-top:4px solid #287d79"><h1 style="color:#1a2655;font-size:24px;font-weight:500">${heading}</h1>${paragraphs}</div></body></html>` };
}

async function installTemplate(database = pool) {
    return (await database.query('INSERT INTO email(course_id,event,subject,body) VALUES(NULL,$1,$2,$3) ON CONFLICT(course_id,event) DO NOTHING RETURNING id', [event, subject, body])).rowCount;
}

async function history(database, courseId, sessionId, ids) {
    const requested = await database.query(`SELECT DISTINCT ON(registration_id) id,registration_id,details FROM log
        WHERE course_id=$1 AND details->>'session_id'=$2 AND registration_id=ANY($3::int[]) AND event=$4 ORDER BY registration_id,id DESC`,
    [courseId, sessionId, ids, prefix + 'requested']);
    const outcomes = await database.query(`SELECT DISTINCT ON(details->>'snapshot_id') details->>'snapshot_id' AS snapshot_id,event,created_at FROM log
        WHERE course_id=$1 AND details->>'session_id'=$2 AND details->>'snapshot_id'=ANY($3::text[]) AND event=ANY($4::text[])
        ORDER BY details->>'snapshot_id',id DESC`, [courseId, sessionId, requested.rows.map(row => String(row.id)), ['started', 'accepted', 'failed', 'uncertain'].map(status => prefix + status)]);
    const states = new Map(outcomes.rows.map(row => [Number(row.snapshot_id), { status: row.event === prefix + 'started' ? 'uncertain' : row.event.slice(prefix.length), updated_at: row.created_at }]));
    return new Map(requested.rows.map(row => [row.registration_id, { id: row.id, snapshot: row.details.snapshot, ...(states.get(row.id) || { status: 'requested' }) }]));
}

function available(course, session) { return Boolean(course.published_at && ['published', 'archived'].includes(course.state) && course.server_time.getTime() >= Date.parse(session.ends_at)); }

function view(row, course, session, saved) {
    const current = saved || { id: null, status: 'not_requested' };
    const changed = Boolean(saved && validSnapshot(saved.snapshot) && !same(row.attendance[session.id] || null, saved.snapshot.entry));
    let reason = null;
    if (row.state !== 'registered' || row.is_cancelled) reason = 'result_cancelled';
    else if (!available(course, session)) reason = 'result_not_available';
    else if (!recipient(row.email)) reason = 'result_recipient_excluded';
    else if (saved && !validSnapshot(saved.snapshot)) reason = 'result_snapshot_unavailable';
    else if (current.status === 'uncertain') reason = 'result_uncertain';
    const actionable = !reason && (changed || ['not_requested', 'requested', 'failed'].includes(current.status));
    return { snapshot_id: current.id, status: current.status, changed, actionable, reason };
}

async function send(courseId, sessionId, body, adminId) {
    if (!attendance.exact(body, ['registration_id', 'original_entry', 'previous_snapshot_id', 'confirm_changed']) ||
        !Number.isInteger(body.registration_id) || body.registration_id < 1 || body.registration_id > 2147483647 ||
        (body.original_entry !== null && !attendance.validEntry(body.original_entry)) || typeof body.confirm_changed !== 'boolean' ||
        (body.previous_snapshot_id !== null && (!Number.isInteger(body.previous_snapshot_id) || body.previous_snapshot_id < 1 || body.previous_snapshot_id > 2147483647))) access.fail('invalid_request');
    const prepared = await attendance.transaction(async function prepare(client) {
        const row = await attendance.registration(client, body.registration_id, courseId, true);
        const { course, session } = await attendance.courseSession(client, courseId, sessionId);
        await client.query('SELECT pg_advisory_xact_lock($1,$2)', [1920234353, row.id]);
        const saved = (await history(client, courseId, sessionId, [row.id])).get(row.id);
        const current = view(row, course, session, saved);
        if (!same(row.attendance[sessionId] || null, body.original_entry)) access.fail('result_conflict', 409);
        if (current.reason && current.reason !== 'result_uncertain') access.fail(current.reason, 409);
        if (body.previous_snapshot_id !== current.snapshot_id) {
            if (saved && !current.changed) return { current };
            access.fail('result_conflict', 409);
        }
        if (!current.actionable) return { current };
        if (current.changed && !body.confirm_changed) access.fail('result_confirmation_required', 409);
        let snapshot = saved?.snapshot;
        let snapshotId = saved?.id;
        if (!saved || current.changed) {
            snapshot = { participant_name: row.full_name, recipient: row.email, course_code: course.code, course_title: course.title.en,
                session_title: session.topic.en, starts_at: session.starts_at, ends_at: session.ends_at,
                entry: entry(row.attendance[sessionId] || null), is_update: Boolean(saved) };
            if (!validSnapshot(snapshot)) access.fail('result_snapshot_unavailable', 409);
            const request = await client.query(`INSERT INTO log(actor_type,admin_id,event,course_id,submission_id,registration_id,details)
                VALUES('admin',$1,$2,$3,$4,$5,$6) RETURNING id`, [adminId, prefix + 'requested', courseId, row.submission_id, row.id,
                { session_id: sessionId, previous_snapshot_id: saved?.id || null, snapshot }]);
            snapshotId = request.rows[0].id;
        }
        const found = await client.query('SELECT id,subject,body FROM email WHERE course_id IS NULL AND event=$1', [event]);
        const template = found.rows[0];
        const log = { actorType: 'admin', adminId, courseId, submissionId: row.submission_id, registrationId: row.id,
            emailId: template?.id, details: { session_id: sessionId, snapshot_id: snapshotId, attempt_id: crypto.randomUUID() } };
        await writeLog(client, { ...log, event: prefix + 'started' });
        return { snapshot, template, log };
    });
    if (prepared.current) return prepared.current;
    let outcome;
    try {
        if (!prepared.template) throw Object.assign(new Error('Result email template is missing.'), { code: 'MAIL_TEMPLATE' });
        const message = render(prepared.template, prepared.snapshot);
        const info = await mail.sendMessage({ to: prepared.snapshot.recipient, ...message });
        if (!info.accepted?.some(value => value.toLowerCase() === prepared.snapshot.recipient.toLowerCase())) throw Object.assign(new Error('Recipient rejected.'), { code: 'EREJECTED' });
        outcome = { status: 'accepted', message_id: info.messageId };
    } catch (error) { outcome = mail.mailFailure(error); }
    try {
        await writeLog(pool, { ...prepared.log, actorType: 'system', adminId: undefined, event: prefix + outcome.status, details: { ...prepared.log.details, ...outcome } });
    } catch { console.error('Attendance result email outcome could not be recorded.'); outcome = { status: 'uncertain' }; }
    return { status: outcome.status, snapshot_id: prepared.log.details.snapshot_id };
}

module.exports = { event, prefix, entry, same, recipient, render, installTemplate, history, view, available, send };
