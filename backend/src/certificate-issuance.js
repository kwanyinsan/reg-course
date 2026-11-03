const express = require('express');
const pool = require('./db');
const issued = require('./issued-certificate');
const mail = require('./certificate-mail');
const { exactKeys } = require('./certificate-template');
const router = express.Router();

function id(req) {
    if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647 || Object.keys(req.query).length) issued.fail('invalid_request');
    return Number(req.params.id);
}

router.get('/courses/:id/certificates', async function list(req, res, next) {
    try {
        const courseId = id(req);
        if (!(await pool.query('SELECT id FROM course WHERE id=$1', [courseId])).rowCount) issued.fail('course_not_found', 404);
        const records = await issued.rows(pool, 'r.course_id=$1', [courseId], false);
        const statuses = await mail.statuses(pool, records.map(row => row.id));
        res.json({ participants: records.map(function participant(row) {
            const certificate = issued.metadata(row);
            const email = statuses.get(row.id) || { status: 'not_requested', updated_at: null };
            const check = certificate ? { reasons: [], attendance: null } : issued.eligibility(row);
            const active = row.registration_state === 'registered' && !row.is_cancelled;
            if (certificate && !active) check.reasons.push('certificate_cancelled');
            if (certificate && !certificate.pdf_available) check.reasons.push('certificate_document_unavailable');
            if (certificate && issued.reserved(certificate.recipient || '')) check.reasons.push('certificate_recipient_excluded');
            return { id: row.id, full_name: row.full_name, reference: row.reference, certificate, email,
                reasons: check.reasons, attendance: check.attendance,
                actionable: certificate ? active && !check.reasons.length && ['requested', 'failed'].includes(email.status) : check.eligible };
        }) });
    } catch (error) { next(error); }
});

router.post('/courses/:id/certificates/send', async function send(req, res, next) {
    try {
        const courseId = id(req);
        if (!exactKeys(req.body, ['registration_id']) || !Number.isInteger(req.body.registration_id) || req.body.registration_id < 1 || req.body.registration_id > 2147483647) issued.fail('invalid_request');
        const result = await issued.issue(req.body.registration_id, courseId, req.admin.id);
        let email;
        try { email = await mail.send(req.body.registration_id, courseId, req.admin.id); }
        catch (error) {
            email = { status: (await mail.statuses(pool, [req.body.registration_id])).get(req.body.registration_id)?.status || 'requested', code: error.status ? error.code : 'certificate_email_unavailable' };
        }
        res.json({ certificate: issued.metadata(result.row), created: result.created, email });
    } catch (error) { next(error); }
});

router.get('/registrations/:id/certificate', async function details(req, res, next) {
    try {
        const registrationId = id(req);
        const row = (await issued.rows(pool, 'r.id=$1', [registrationId], false))[0];
        if (!row) issued.fail('certificate_registration_missing', 404);
        res.json({ certificate: issued.metadata(row), email: (await mail.statuses(pool, [registrationId])).get(registrationId) || { status: 'not_requested' } });
    } catch (error) { next(error); }
});

router.get('/registrations/:id/certificate/pdf', async function download(req, res, next) {
    try {
        const row = (await issued.rows(pool, 'r.id=$1', [id(req)]))[0];
        if (!row || !row.certificate_number) issued.fail('certificate_registration_missing', 404);
        const saved = issued.document(row);
        res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${saved.data.filename}"`,
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.send(saved.buffer);
    } catch (error) { next(error); }
});

router.use(function certificateError(error, req, res, next) {
    void next;
    if (error.status) return res.status(error.status).json({ code: error.code, reasons: error.reasons });
    if (['55P03', '40P01'].includes(error.code)) return res.status(409).json({ code: 'certificate_busy' });
    if (error.code === '23505') return res.status(409).json({ code: 'certificate_number_conflict' });
    console.error('Certificate issuance request could not be completed.');
    res.status(503).json({ code: 'certificate_issue_failed' });
});

module.exports = router;
