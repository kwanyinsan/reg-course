const crypto = require('node:crypto');
const pool = require('./db');
const writeLog = require('./log');
const mail = require('./mail');
const attendance = require('./attendance');
const access = require('./attendance-access');

const event = 'attendance.scanner';
const prefix = 'attendance.email.';
const subject = 'Attendance scanner — {{course_code}} — {{session_title}}';
const body = `Dear {{participant_name}},

Attendance taking is open for:

{{course_title}}
{{session_title}}
{{session_time}} — Hong Kong time

{{scanner_action}}

Check that your name is correct, then select Start scanner and allow camera access. Scan the QR code displayed by your teacher.

When your attendance is recorded, the scanner will show a confirmation and the recorded time.

Attendance closes at {{closing_time}}.

This link is personal. Do not forward it. If you cannot access the scanner or confirm your attendance, speak to the course administrator.`;

function escape(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function date(value) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)); }
function excluded(address) { return /@(?:[^@]*\.)?(?:invalid|test|localhost)$/i.test(address); }

function render(template, row, course, session, round) {
    const url = access.studentLink(round, row.id);
    const values = { participant_name: row.full_name, course_code: course.code, course_title: course.title.en,
        session_title: session.topic.en, session_time: `${date(session.starts_at)} – ${date(session.ends_at)}`,
        closing_time: date(round.closes_at), scanner_action: `Open attendance scanner\n${url}` };
    function replace(value, html = false) {
        return value.replace(/{{([^{}]+)}}/g, function token(match, key) {
            if (!Object.hasOwn(values, key)) throw Object.assign(new Error('Unknown attendance placeholder.'), { code: 'MAIL_TEMPLATE' });
            return html ? escape(values[key]) : values[key];
        });
    }
    const html = template.body.split(/\n\s*\n/).map(function paragraph(part) {
        if (part.trim() === '{{scanner_action}}') return `<p><a href="${escape(url)}" style="display:inline-block;padding:12px 20px;background:#287d79;color:#fff;text-decoration:none;font-weight:bold">Open attendance scanner</a></p>`;
        return `<p style="line-height:1.6">${replace(part, true).replace(/\n/g, '<br>')}</p>`;
    }).join('');
    return { subject: replace(template.subject).replace(/[\r\n]+/g, ' '), text: replace(template.body),
        html: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body style="margin:0;background:#f5f5f5;color:#222;font-family:Arial,sans-serif"><div style="max-width:640px;margin:24px auto;padding:24px;background:#fff;border-top:4px solid #287d79"><h1 style="color:#1a2655;font-size:24px;font-weight:500">Attendance scanner</h1>${html}</div></body></html>` };
}

async function installTemplate(database = pool) {
    const result = await database.query('INSERT INTO email(course_id,event,subject,body) VALUES(NULL,$1,$2,$3) ON CONFLICT(course_id,event) DO NOTHING RETURNING id', [event, subject, body]);
    return result.rowCount;
}

async function statuses(database, roundId) {
    const result = await database.query(`SELECT DISTINCT ON (registration_id) registration_id,event,created_at FROM log
        WHERE details->>'round_id'=$1 AND event=ANY($2::text[]) ORDER BY registration_id,id DESC`,
    [String(roundId), ['requested', 'started', 'accepted', 'failed', 'uncertain'].map(value => prefix + value)]);
    return new Map(result.rows.map(row => [row.registration_id, { status: row.event === prefix + 'started' ? 'uncertain' : row.event.slice(prefix.length), updated_at: row.created_at }]));
}

async function send(courseId, sessionId, registrationId, retry, adminId) {
    const prepared = await attendance.transaction(async function prepare(client) {
        const round = await attendance.roundFor(client, courseId, sessionId);
        if (!round || !round.registration_ids.includes(registrationId)) access.fail('attendance_unavailable', 409);
        const claims = { registration_id: registrationId, course_id: courseId, session_id: sessionId,
            round_id: round.id, expires_at: new Date(round.closes_at).getTime() };
        const data = await attendance.context(client, claims, true);
        if (excluded(data.row.email)) access.fail('attendance_email_excluded', 409);
        await client.query('SELECT pg_advisory_xact_lock($1,$2)', [1920234351, registrationId]);
        const current = (await statuses(client, round.id)).get(registrationId) || { status: 'not_requested' };
        if (!(retry ? ['not_requested', 'requested', 'failed'] : ['not_requested', 'requested']).includes(current.status)) return { current };
        const found = await client.query('SELECT id,subject,body FROM email WHERE course_id IS NULL AND event=$1', [event]);
        const template = found.rows[0];
        const attempt = crypto.randomUUID();
        const entry = { actorType: 'admin', adminId, courseId, submissionId: data.row.submission_id, registrationId,
            emailId: template?.id, details: { round_id: round.id, session_id: sessionId, attempt_id: attempt } };
        if (current.status === 'not_requested') await writeLog(client, { ...entry, event: prefix + 'requested' });
        await writeLog(client, { ...entry, event: prefix + 'started' });
        return { data, template, entry };
    });
    if (prepared.current) return prepared.current;
    const { data, template, entry } = prepared;
    let outcome;
    try {
        if (!template) throw Object.assign(new Error('Missing attendance template.'), { code: 'MAIL_TEMPLATE' });
        const message = render(template, data.row, data.course, data.session, data.round);
        const info = await mail.sendMessage({ to: data.row.email, ...message });
        if (!info.accepted?.some(value => value.toLowerCase() === data.row.email.toLowerCase())) throw Object.assign(new Error('Recipient rejected.'), { code: 'EREJECTED' });
        outcome = { status: 'accepted', message_id: info.messageId };
    } catch (error) { outcome = mail.mailFailure(error); }
    try {
        await writeLog(pool, { ...entry, actorType: 'system', adminId: undefined, event: prefix + outcome.status, details: { ...entry.details, ...outcome } });
        return outcome;
    } catch {
        console.error('Attendance email outcome could not be recorded.');
        return { status: 'uncertain' };
    }
}

module.exports = { render, installTemplate, statuses, send, excluded };
