const express = require('express');
const pool = require('./db');
const writeLog = require('./log');
const { starter, exactKeys, validateTemplate, lockReason } = require('./certificate-template');
const { checkLayout, renderCertificate, previewValues } = require('./certificate-pdf');

const router = express.Router();

function courseId(req) {
    if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647 || Object.keys(req.query).length) {
        throw Object.assign(new Error('Invalid certificate request.'), { status: 400, code: 'invalid_request' });
    }
    return Number(req.params.id);
}

function responseData(course, certificate) {
    return { course, certificate: certificate || null, editable: !lockReason(course), lock_reason: lockReason(course),
        starter_template: !certificate && !lockReason(course) ? starter : null, preview_values: previewValues };
}

async function readCourse(id) {
    const result = await pool.query(
        `SELECT c.id,c.code,c.title,c.state,c.published_at,
                CASE WHEN k.id IS NULL THEN NULL ELSE jsonb_build_object('id',k.id,'template',k.template) END AS certificate
         FROM course c LEFT JOIN certificate k ON k.course_id=c.id WHERE c.id=$1`, [id]);
    if (!result.rowCount) throw Object.assign(new Error('Course not found.'), { status: 404, code: 'course_not_found' });
    const { certificate, ...course } = result.rows[0];
    return responseData(course, certificate);
}

router.get('/courses/:id/certificate', async function readTemplate(req, res, next) {
    try { res.json(await readCourse(courseId(req))); }
    catch (error) { next(error); }
});

router.put('/courses/:id/certificate', async function saveTemplate(req, res, next) {
    let client;
    try {
        const id = courseId(req);
        if (!exactKeys(req.body, ['template', 'original_template'])) throw Object.assign(new Error('Invalid request.'), { status: 400, code: 'invalid_request' });
        const issue = validateTemplate(req.body.template);
        if (issue) throw Object.assign(new Error('Invalid template.'), { ...issue, status: 400 });
        if (req.body.original_template !== null && validateTemplate(req.body.original_template)) throw Object.assign(new Error('Invalid original template.'), { status: 400, code: 'invalid_request' });
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='5s'");
        const found = await client.query('SELECT id,code,title,state,published_at FROM course WHERE id=$1 FOR UPDATE', [id]);
        if (!found.rowCount) throw Object.assign(new Error('Course not found.'), { status: 404, code: 'course_not_found' });
        const course = found.rows[0];
        const reason = lockReason(course);
        if (reason) throw Object.assign(new Error('Certificate wording is locked.'), { status: 409, code: 'template_locked', lock_reason: reason });
        const current = await client.query('SELECT id,template FROM certificate WHERE course_id=$1 FOR UPDATE', [id]);
        let certificate = current.rows[0];
        const comparison = await client.query(
            `SELECT $1::jsonb IS NOT DISTINCT FROM $2::jsonb AS matches,
                    $1::jsonb IS NOT DISTINCT FROM $3::jsonb AS unchanged,valid_certificate_template($3::jsonb) AS valid`,
            [certificate?.template ?? null, req.body.original_template, req.body.template]);
        const checked = comparison.rows[0];
        if (!checked.matches && !checked.unchanged) throw Object.assign(new Error('The saved template changed.'), { status: 409, code: 'template_conflict' });
        if (!checked.valid) throw Object.assign(new Error('Invalid template.'), { status: 400, code: 'invalid_template' });
        checkLayout(req.body.template, course);
        if (!checked.unchanged) {
            const saved = certificate ? await client.query('UPDATE certificate SET template=$1 WHERE id=$2 RETURNING id,template', [req.body.template, certificate.id])
                : await client.query('INSERT INTO certificate(course_id,template) VALUES($1,$2) RETURNING id,template', [id, req.body.template]);
            certificate = saved.rows[0];
            await writeLog(client, { actorType: 'admin', adminId: req.admin.id, courseId: id, event: 'course.certificate_template_saved',
                details: { certificate_id: certificate.id } });
        }
        await client.query('COMMIT');
        res.json({ ...responseData(course, certificate), code: 'saved' });
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        next(error);
    } finally { if (client) client.release(); }
});

const previews = new Map();
router.post('/courses/:id/certificate/preview', async function previewTemplate(req, res, next) {
    try {
        const id = courseId(req);
        if (!exactKeys(req.body, ['template'])) throw Object.assign(new Error('Invalid request.'), { status: 400, code: 'invalid_request' });
        const now = Date.now();
        for (const [adminId, entry] of previews) if (entry.until <= now) previews.delete(adminId);
        let entry = previews.get(req.admin.id);
        if (!entry) { entry = { count: 0, until: now + 60000 }; previews.set(req.admin.id, entry); }
        if (++entry.count > 30) throw Object.assign(new Error('Too many previews.'), { status: 429, code: 'preview_limit' });
        const data = await readCourse(id);
        if (!data.editable) {
            const same = await pool.query('SELECT $1::jsonb IS NOT DISTINCT FROM $2::jsonb AS matches', [data.certificate?.template ?? null, req.body.template]);
            if (!data.certificate || !same.rows[0].matches) throw Object.assign(new Error('Locked template.'), { status: 409, code: 'template_locked' });
        }
        const buffer = await renderCertificate(req.body.template, data.course);
        res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="certificate-preview-${id}.pdf"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.send(buffer);
    } catch (error) { next(error); }
});

router.use(function certificateError(error, req, res, next) {
    void next;
    if (error.status) return res.status(error.status).json({ code: error.code, field: error.field, lock_reason: error.lock_reason });
    if (['55P03', '40P01'].includes(error.code)) return res.status(409).json({ code: 'course_busy' });
    console.error('Certificate request could not be completed.');
    res.status(500).json({ code: 'certificate_failed' });
});

module.exports = router;
