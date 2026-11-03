const crypto = require('node:crypto');
const pool = require('./db');
const writeLog = require('./log');
const { percentage } = require('./attendance');
const { validateTemplate } = require('./certificate-template');
const pdf = require('./certificate-pdf');

const maximumPdf = 2 * 1024 * 1024;

function fail(code, status = 400, reasons) {
    throw Object.assign(new Error('Certificate request could not be completed.'), { code, status, reasons });
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

async function rows(database, where, values, includePdf = true) {
    return (await database.query(`SELECT r.id,r.submission_id,r.course_id,r.state AS registration_state,r.attendance,
        r.certificate_number,r.certificate_issued_at,${includePdf ? 'r.certificate_data' : "(r.certificate_data-'pdf_base64')"} AS certificate_data,
        COALESCE(r.certificate_data ? 'pdf_base64',false) AS has_pdf,s.reference,s.full_name,s.email,s.is_cancelled,
        c.code,c.title,c.sessions,c.state,c.published_at,c.attendance_requirement_percent,k.template,
        clock_timestamp() AS server_time FROM registration r JOIN submission s ON s.id=r.submission_id
        JOIN course c ON c.id=r.course_id LEFT JOIN certificate k ON k.course_id=c.id WHERE ${where} ORDER BY r.id`, values)).rows;
}

async function locked(database, id, courseId) {
    const lookup = await database.query('SELECT submission_id,course_id FROM registration WHERE id=$1', [id]);
    const original = lookup.rows[0];
    if (!original || (courseId && original.course_id !== courseId)) fail('certificate_registration_missing', 404);
    await database.query('SELECT id FROM submission WHERE id=$1 FOR UPDATE', [original.submission_id]);
    await database.query('SELECT id FROM course WHERE id=$1 FOR SHARE', [original.course_id]);
    await database.query('SELECT id FROM registration WHERE id=$1 FOR UPDATE', [id]);
    await database.query('SELECT id FROM certificate WHERE course_id=$1 FOR SHARE', [original.course_id]);
    const row = (await rows(database, 'r.id=$1', [id]))[0];
    if (!row || row.course_id !== original.course_id || row.submission_id !== original.submission_id) fail('certificate_busy', 409);
    return row;
}

function values(row) {
    const issued = row.server_time;
    const year = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Hong_Kong', year: 'numeric' }).format(issued);
    return { participant_name: row.full_name, certificate_number: `CERT-${year}-${String(row.id).padStart(6, '0')}`,
        issued_date: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', day: 'numeric', month: 'long', year: 'numeric' }).format(issued) };
}

function reserved(address) { return /@(?:[^@]*\.)?(?:invalid|test|localhost)$/i.test(address); }
function recipient(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s@,;:<>"()\[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value); }

function eligibility(row) {
    const reasons = [];
    const attendance = percentage(row, row, row.server_time.getTime());
    if (row.registration_state !== 'registered' || row.is_cancelled) reasons.push('certificate_cancelled');
    if (!row.published_at || !['published', 'archived'].includes(row.state)) reasons.push('certificate_course_unavailable');
    if (attendance.provisional) reasons.push('certificate_course_unfinished');
    if (!attendance.meets_requirement) reasons.push('certificate_attendance_low');
    if (!row.template) reasons.push('certificate_template_missing');
    else if (validateTemplate(row.template)) reasons.push('certificate_template_invalid');
    else {
        try { pdf.checkLayout(row.template, row, values(row)); }
        catch (error) { reasons.push(['unsupported_character', 'content_overflow', 'invalid_values'].includes(error.code) ? error.code : 'certificate_template_invalid'); }
    }
    if (!recipient(row.email) || reserved(row.email)) reasons.push('certificate_recipient_excluded');
    return { eligible: reasons.length === 0, reasons, attendance };
}

function metadata(row) {
    const data = row.certificate_data;
    return row.certificate_number ? { number: row.certificate_number, issued_at: row.certificate_issued_at,
        issued_date: data?.values?.issued_date || null, participant_name: data?.values?.participant_name || null,
        course_title: data?.course?.title?.en || null, recipient: data?.recipient || null,
        filename: data?.filename || null, pdf_available: Boolean(row.has_pdf && data?.sha256 && data?.byte_length) } : null;
}

function document(row) {
    const data = row.certificate_data;
    if (!row.certificate_number || !data || typeof data.pdf_base64 !== 'string' || data.pdf_base64.length > Math.ceil(maximumPdf / 3) * 4 ||
        data.values?.certificate_number !== row.certificate_number || !/^[a-f0-9]{64}$/.test(data.sha256 || '') ||
        data.filename !== `${row.certificate_number}.pdf` || !/^CERT-\d{4}-\d+\.pdf$/.test(data.filename || '') || !recipient(data.recipient) ||
        typeof data.values?.participant_name !== 'string' || typeof data.values?.issued_date !== 'string' ||
        typeof data.course?.code !== 'string' || typeof data.course?.title?.en !== 'string') fail('certificate_document_unavailable', 503);
    const buffer = Buffer.from(data.pdf_base64, 'base64');
    if (!buffer.length || buffer.length > maximumPdf || buffer.length !== data.byte_length || buffer.toString('base64') !== data.pdf_base64 ||
        buffer.subarray(0, 5).toString() !== '%PDF-' || crypto.createHash('sha256').update(buffer).digest('hex') !== data.sha256) fail('certificate_document_unavailable', 503);
    return { buffer, data };
}

async function issue(id, courseId, adminId) {
    return transaction(async function create(client) {
        const row = await locked(client, id, courseId);
        if (row.certificate_number) return { row, created: false };
        const check = eligibility(row);
        if (!check.eligible) fail('certificate_not_eligible', 409, check.reasons);
        const replacements = values(row);
        const course = { code: row.code, title: { en: row.title.en } };
        const buffer = await pdf.renderCertificate(row.template, course, replacements, false);
        if (buffer.length > maximumPdf) fail('certificate_pdf_too_large', 422);
        const snapshot = { course, values: replacements, template: row.template,
            resolved: pdf.resolveCertificate(row.template, course, replacements), recipient: row.email, issued_by: adminId,
            qualification: { completed: check.attendance.completed, total: check.attendance.total, required: check.attendance.required,
                percent: check.attendance.percent, evaluated_at: row.server_time.toISOString() },
            filename: `${replacements.certificate_number}.pdf`, pdf_base64: buffer.toString('base64'), byte_length: buffer.length,
            sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
        await client.query('UPDATE registration SET certificate_number=$2,certificate_issued_at=$3,certificate_data=$4 WHERE id=$1',
            [id, replacements.certificate_number, row.server_time, snapshot]);
        const entry = { actorType: 'admin', adminId, courseId: row.course_id, submissionId: row.submission_id, registrationId: id,
            details: { certificate_number: replacements.certificate_number, pdf_sha256: snapshot.sha256,
                attended_sessions: check.attendance.completed, total_sessions: check.attendance.total } };
        await writeLog(client, { ...entry, event: 'certificate.issued' });
        await writeLog(client, { ...entry, event: 'certificate.email.requested', details: { certificate_number: replacements.certificate_number } });
        row.certificate_number = replacements.certificate_number;
        row.certificate_issued_at = row.server_time;
        row.certificate_data = snapshot;
        row.has_pdf = true;
        return { row, created: true };
    });
}

module.exports = { fail, transaction, rows, locked, values, reserved, recipient, eligibility, metadata, document, issue };
