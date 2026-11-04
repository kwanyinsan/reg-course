const crypto = require('node:crypto');
const pool = require('./db');
const writeLog = require('./log');
const mail = require('./mail');
const payments = require('./payment');

const templateEvent = 'application.acknowledgement';
const logPrefix = 'acknowledgement.';
const lockNamespace = 1920234350;
const subject = 'Application acknowledgement — {{application_reference}}';
const body = `Dear {{participant_name}},

Your course application has been recorded.

Application reference: {{application_reference}}

Selected courses

{{courses}}

Total course fees: {{combined_total}}

All session dates and times are shown in Hong Kong time (UTC+8).

{{payment_note}}

{{payment_action}}

Please keep this email and your application reference for your records.

This message acknowledges your application. It does not confirm payment, attendance eligibility or course completion.`;

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function escape(character) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
}

function money(value) {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'HKD', currencyDisplay: 'code',
        minimumFractionDigits: Number(value) % 1 === 0 ? 0 : 2 }).format(Number(value));
}

function sessionDate(session) {
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: 'short', day: 'numeric' });
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const start = new Date(session.starts_at);
    const end = new Date(session.ends_at);
    return `${date.format(start)}, ${time.format(start)} – ${date.format(start) === date.format(end) ? '' : date.format(end) + ', '}${time.format(end)}`;
}

function render(template, submission, courses, payment = null) {
    let paymentUrl = payment?.access_url || '';
    if (paymentUrl) {
        let url;
        try { url = new URL(paymentUrl); } catch { /* Reject unexpected links below. */ }
        if (!url || url.origin !== process.env.APP_ORIGIN || url.username || url.password || url.pathname !== '/' || url.search ||
            !/^#payment\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(url.hash)) {
            throw Object.assign(new Error('Invalid acknowledgement payment link.'), { code: 'MAIL_TEMPLATE' });
        }
    }
    let paymentNote = 'Online payment is not available for this application.';
    if (Number(submission.total) === 0) paymentNote = 'No payment is required for your selected courses.';
    else if (payment?.state === 'pending' && payment.can_pay) {
        const deadline = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(payment.due_at));
        paymentNote = `Please complete the combined payment before ${deadline} (Hong Kong time, UTC+8). The payment link expires at this deadline.`;
    } else if (payment?.state === 'paid') paymentNote = paymentUrl ? 'You can view the existing payment result using the link below.'
        : 'The website has an existing payment record for this application. The payment link has expired.';
    else if (payment?.state === 'expired') paymentNote = 'The payment deadline has passed. Online payment is no longer available.';
    else if (payment?.state === 'cancelled') paymentNote = 'Payment is unavailable because this application or payment was cancelled.';
    if (Number(submission.total) === 0) paymentUrl = '';
    const actionNote = 'Opening the payment page does not record a payment. Review the details and select Pay when available. This action records the payment; no money is transferred.';
    const textCourses = courses.map(function course(item) {
        return `${item.code} — ${item.title.en}\nSession date(s): ${item.sessions.map(sessionDate).join('; ')}\nFee: ${money(item.fee)}`;
    }).join('\n\n');
    const rows = courses.map(function course(item) {
        return `<tr><td style="padding:12px;border-bottom:1px solid #ddd;vertical-align:top">${escapeHtml(item.code)} — ${escapeHtml(item.title.en)}</td><td style="padding:12px;border-bottom:1px solid #ddd;vertical-align:top">${item.sessions.map(function date(session) { return escapeHtml(sessionDate(session)); }).join('<br>')}</td><td style="padding:12px;border-bottom:1px solid #ddd;vertical-align:top;white-space:nowrap">${escapeHtml(money(item.fee))}</td></tr>`;
    }).join('');
    const table = `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px"><thead><tr style="background:#f5f5f5;color:#1a2655"><th style="padding:12px;text-align:left">Course</th><th style="padding:12px;text-align:left">Session dates and times</th><th style="padding:12px;text-align:left">Fee</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="2" style="padding:12px;text-align:left">Total course fees</th><td style="padding:12px;font-weight:bold;white-space:nowrap">${escapeHtml(money(submission.total))}</td></tr></tfoot></table>`;
    const values = {
        participant_name: submission.full_name,
        application_reference: submission.reference,
        courses: textCourses,
        combined_total: money(submission.total),
        payment_note: paymentNote,
        payment_action: paymentUrl ? `View payment\n${paymentUrl}\n\n${actionNote}` : '',
    };
    function replace(text, html = false) {
        return text.replace(/{{([^{}]+)}}/g, function placeholder(match, key) {
            if (!Object.hasOwn(values, key)) throw Object.assign(new Error('Unknown acknowledgement placeholder.'), { code: 'MAIL_TEMPLATE' });
            return html ? key === 'courses' ? table : escapeHtml(values[key]) : values[key];
        });
    }
    const renderedSubject = replace(template.subject).replace(/[\r\n]+/g, ' ');
    const text = replace(template.body);
    const paragraphs = template.body.split(/\n\s*\n/).map(function paragraph(part) {
        if (part.trim() === '{{courses}}') return table;
        if (part.trim() === '{{payment_action}}') return paymentUrl
            ? `<p style="margin:0 0 18px"><a href="${escapeHtml(paymentUrl)}" style="display:inline-block;background:#287d79;color:#fff;padding:12px 20px;text-decoration:none;font-weight:bold">View payment</a></p><p style="margin:0 0 18px;line-height:1.6">${actionNote}</p>` : '';
        if (part.trim() === 'Total course fees: {{combined_total}}') return '';
        return `<p style="margin:0 0 18px;line-height:1.6">${replace(escapeHtml(part), true).replace(/\n/g, '<br>')}</p>`;
    }).join('');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f5;color:#222;font-family:Arial,sans-serif"><div style="max-width:640px;margin:24px auto;background:#fff;border-top:4px solid #287d79"><div style="padding:24px"><p style="margin:0 0 12px;color:#1a2655">Course registration</p><h1 style="font-size:24px;font-weight:500;color:#1a2655;margin:0 0 24px">Application acknowledgement</h1>${paragraphs}</div></div></body></html>`;
    return { subject: renderedSubject, text, html };
}

async function status(database, submissionId) {
    const result = await database.query(
        `SELECT id,event,created_at FROM log WHERE submission_id=$1 AND event=ANY($2::text[]) ORDER BY id DESC LIMIT 1`,
        [submissionId, ['requested', 'started', 'accepted', 'failed', 'uncertain'].map(function event(name) { return logPrefix + name; })]);
    const record = result.rows[0];
    if (!record) return { status: 'not_requested', updated_at: null };
    const state = record.event.slice(logPrefix.length);
    return { status: state === 'started' ? 'uncertain' : state, updated_at: record.created_at };
}

async function request(database, submissionId) {
    await writeLog(database, { actorType: 'system', event: logPrefix + 'requested', submissionId });
}

async function installTemplate(database = pool) {
    const result = await database.query(
        `INSERT INTO email(course_id,event,subject,body) VALUES(NULL,$1,$2,$3)
         ON CONFLICT(course_id,event) DO NOTHING RETURNING id`, [templateEvent, subject, body]);
    return result.rowCount;
}

async function updatePaymentTemplate() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query('SELECT id,body FROM email WHERE course_id IS NULL AND event=$1 FOR UPDATE', [templateEvent]);
        const template = result.rows[0];
        if (!template) throw new Error('The shared acknowledgement template is missing.');
        if (template.body === body) { await client.query('COMMIT'); return 0; }
        const previous = body.replace('\n\n{{payment_action}}', '');
        if (template.body !== previous) throw new Error('The shared acknowledgement template changed and needs review.');
        const updated = await client.query('UPDATE email SET body=$2 WHERE id=$1 AND body=$3 RETURNING id', [template.id, body, previous]);
        if (updated.rowCount !== 1) throw new Error('The shared acknowledgement template changed during its update.');
        await client.query('COMMIT');
        return updated.rowCount;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}

async function send(submissionId, options = {}) {
    const client = await pool.connect();
    let attempt;
    let submission;
    let courses;
    let template;
    let payment;
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='5s'");
        await client.query('SELECT pg_advisory_xact_lock($1,$2)', [lockNamespace, submissionId]);
        const current = await status(client, submissionId);
        if (!(options.retry ? ['requested', 'failed'] : ['requested']).includes(current.status)) {
            await client.query('COMMIT');
            return current;
        }
        const found = await client.query('SELECT id,reference,full_name,email,total FROM submission WHERE id=$1', [submissionId]);
        if (!found.rowCount) throw new Error('Application not found.');
        submission = found.rows[0];
        payment = await payments.forSubmission(client, submissionId, true);
        const selected = await client.query(
            `SELECT c.code,c.title,c.sessions,r.fee FROM registration r JOIN course c ON c.id=r.course_id
             WHERE r.submission_id=$1 ORDER BY r.course_id`, [submissionId]);
        courses = selected.rows;
        const templates = await client.query('SELECT id,subject,body FROM email WHERE course_id IS NULL AND event=$1', [templateEvent]);
        template = templates.rows[0];
        attempt = crypto.randomUUID();
        await writeLog(client, { actorType: 'system', event: logPrefix + 'started', submissionId,
            emailId: template?.id, details: { attempt_id: attempt, source: options.retry ? 'manual' : 'application' } });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }

    let outcome;
    try {
        if (!template) throw Object.assign(new Error('Acknowledgement template is missing.'), { code: 'MAIL_TEMPLATE' });
        const message = render(template, submission, courses, payment);
        const info = await (options.sendMessage || mail.sendMessage)({ to: submission.email, ...message });
        if (!info.accepted?.some(function recipient(address) { return address.toLowerCase() === submission.email.toLowerCase(); })) {
            throw Object.assign(new Error('Recipient not accepted.'), { code: 'EREJECTED' });
        }
        outcome = { status: 'accepted', message_id: info.messageId };
    } catch (error) { outcome = mail.mailFailure(error); }

    try {
        await writeLog(pool, { actorType: 'system', event: logPrefix + outcome.status, submissionId,
            emailId: template?.id, details: { attempt_id: attempt, ...outcome } });
        return { status: outcome.status, updated_at: new Date().toISOString() };
    } catch {
        console.error('Acknowledgement outcome could not be recorded for submission', submissionId);
        return { status: 'uncertain', updated_at: null };
    }
}

module.exports = { request, status, send, render, installTemplate, updatePaymentTemplate };
