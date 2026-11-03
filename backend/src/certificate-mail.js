const crypto = require('node:crypto');
const pool = require('./db');
const writeLog = require('./log');
const mail = require('./mail');
const issued = require('./issued-certificate');

const event = 'certificate.issued';
const prefix = 'certificate.email.';
const subject = 'Thank you for attending — {{course_code}}';
const body = `Dear {{participant_name}},

Thank you for attending {{course_title}}.

Your certificate is attached to this email.

Course code: {{course_code}}
Certificate number: {{certificate_number}}
Issue date: {{issued_date}}

Please keep the attached PDF for your records.`;

function escape(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }

function render(template, snapshot) {
    const values = { ...snapshot.values, course_code: snapshot.course.code, course_title: snapshot.course.title.en };
    function replace(value, html = false) {
        return value.replace(/{{([^{}]+)}}/g, function placeholder(match, key) {
            if (!Object.hasOwn(values, key) || typeof values[key] !== 'string') throw Object.assign(new Error('Invalid certificate email template.'), { code: 'MAIL_TEMPLATE' });
            return html ? escape(values[key]) : values[key];
        });
    }
    const paragraphs = template.body.split(/\n\s*\n/).map(value => `<p style="line-height:1.6">${replace(value, true).replace(/\n/g, '<br>')}</p>`).join('');
    return { subject: replace(template.subject).replace(/[\r\n]+/g, ' '), text: replace(template.body),
        html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f5;color:#222;font-family:Arial,sans-serif"><div style="max-width:640px;margin:24px auto;padding:24px;background:#fff;border-top:4px solid #287d79"><h1 style="color:#1a2655;font-size:24px;font-weight:500">Thank you for attending</h1>${paragraphs}</div></body></html>` };
}

async function installTemplate(database = pool) {
    return (await database.query('INSERT INTO email(course_id,event,subject,body) VALUES(NULL,$1,$2,$3) ON CONFLICT(course_id,event) DO NOTHING RETURNING id', [event, subject, body])).rowCount;
}

async function statuses(database, ids) {
    const result = await database.query(`SELECT DISTINCT ON(registration_id) registration_id,event,created_at FROM log
        WHERE registration_id=ANY($1::int[]) AND event=ANY($2::text[]) ORDER BY registration_id,id DESC`,
    [ids, ['requested', 'started', 'accepted', 'failed', 'uncertain'].map(value => prefix + value)]);
    return new Map(result.rows.map(row => [row.registration_id, { status: row.event === prefix + 'started' ? 'uncertain' : row.event.slice(prefix.length), updated_at: row.created_at }]));
}

async function send(id, courseId, adminId) {
    const prepared = await issued.transaction(async function prepare(client) {
        const row = await issued.locked(client, id, courseId);
        if (row.registration_state !== 'registered' || row.is_cancelled) issued.fail('certificate_cancelled', 409);
        const saved = issued.document(row);
        if (issued.reserved(saved.data.recipient)) issued.fail('certificate_recipient_excluded', 409);
        await client.query('SELECT pg_advisory_xact_lock($1,$2)', [1920234352, id]);
        const current = (await statuses(client, [id])).get(id) || { status: 'not_requested' };
        if (!['requested', 'failed'].includes(current.status)) return { current };
        const result = await client.query('SELECT id,subject,body FROM email WHERE course_id IS NULL AND event=$1', [event]);
        const template = result.rows[0];
        const entry = { actorType: 'admin', adminId, courseId: row.course_id, submissionId: row.submission_id, registrationId: id,
            emailId: template?.id, details: { attempt_id: crypto.randomUUID(), certificate_number: row.certificate_number } };
        await writeLog(client, { ...entry, event: prefix + 'started' });
        return { ...saved, template, entry };
    });
    if (prepared.current) return prepared.current;
    let outcome;
    try {
        if (!prepared.template) throw Object.assign(new Error('Certificate email template is missing.'), { code: 'MAIL_TEMPLATE' });
        const info = await mail.sendMessage({ to: prepared.data.recipient, ...render(prepared.template, prepared.data),
            attachments: [{ filename: prepared.data.filename, content: prepared.buffer, contentType: 'application/pdf' }] });
        if (!info.accepted?.some(value => value.toLowerCase() === prepared.data.recipient.toLowerCase())) throw Object.assign(new Error('Recipient rejected.'), { code: 'EREJECTED' });
        outcome = { status: 'accepted', message_id: info.messageId };
    } catch (error) { outcome = mail.mailFailure(error); }
    try {
        await writeLog(pool, { ...prepared.entry, actorType: 'system', adminId: undefined, event: prefix + outcome.status,
            details: { ...prepared.entry.details, ...outcome } });
        return outcome;
    } catch {
        console.error('Certificate email outcome could not be recorded.');
        return { status: 'uncertain' };
    }
}

module.exports = { render, installTemplate, statuses, send };
