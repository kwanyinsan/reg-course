const express = require('express');
const pool = require('./db');
const writeLog = require('./log');
const { validateDefinition, questionLockReason, exactKeys } = require('./question-definition');

const router = express.Router();

function readCourseId(req, res) {
    if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647 || Object.keys(req.query).length) {
        res.status(400).json({ code: 'invalid_request', message: 'Provide a valid course ID without query parameters.' });
        return null;
    }
    return Number(req.params.id);
}

function responseData(course, question) {
    const reason = questionLockReason(course);
    return {
        course: { id: course.id, code: course.code, title: course.title, state: course.state, published_at: course.published_at },
        question: question || null, editable: reason === null, lock_reason: reason,
    };
}

router.get('/courses/:id/questions', async function readQuestions(req, res, next) {
    const id = readCourseId(req, res);
    if (!id) return;
    try {
        const result = await pool.query(
            `SELECT c.id, c.code, c.title, c.state, c.published_at,
                    (SELECT COUNT(*)::int FROM registration r WHERE r.course_id = c.id) AS total_registrations,
                    CASE WHEN q.id IS NULL THEN NULL ELSE jsonb_build_object('id', q.id, 'definition', q.definition) END AS question
             FROM course c LEFT JOIN question q ON q.course_id = c.id WHERE c.id = $1`, [id]);
        if (!result.rowCount) return res.status(404).json({ code: 'course_not_found', message: 'Course not found.' });
        const course = result.rows[0];
        res.json(responseData(course, course.question));
    } catch (error) { next(error); }
});

router.put('/courses/:id/questions', async function saveQuestions(req, res, next) {
    const id = readCourseId(req, res);
    if (!id) return;
    if (!exactKeys(req.body, ['definition', 'original_definition'])) {
        return res.status(400).json({ code: 'invalid_request', message: 'Provide the definition and original definition.' });
    }
    const error = validateDefinition(req.body.definition);
    if (error) return res.status(400).json({ ...error, message: 'The question definition is invalid.' });
    if (req.body.original_definition !== null && validateDefinition(req.body.original_definition)) {
        return res.status(400).json({ code: 'invalid_request', message: 'The original definition is invalid.' });
    }
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        const result = await client.query('SELECT id, code, title, state, published_at FROM course WHERE id = $1 FOR UPDATE', [id]);
        if (!result.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ code: 'course_not_found', message: 'Course not found.' });
        }
        const course = result.rows[0];
        const count = await client.query('SELECT COUNT(*)::int AS total FROM registration WHERE course_id = $1', [id]);
        course.total_registrations = count.rows[0].total;
        const reason = questionLockReason(course);
        if (reason) {
            await client.query('ROLLBACK');
            return res.status(409).json({ code: 'form_locked', lock_reason: reason, message: 'This course question bank is locked.' });
        }
        const current = await client.query('SELECT id, definition FROM question WHERE course_id = $1 FOR UPDATE', [id]);
        const original = current.rows[0]?.definition ?? null;
        const comparison = await client.query(
            `SELECT $1::jsonb IS NOT DISTINCT FROM $2::jsonb AS matches,
                    $1::jsonb IS NOT DISTINCT FROM $3::jsonb AS unchanged, valid_questions($3::jsonb) AS valid`,
            [original, req.body.original_definition, req.body.definition]);
        if (!comparison.rows[0].matches && !comparison.rows[0].unchanged) {
            await client.query('ROLLBACK');
            return res.status(409).json({ code: 'definition_conflict', message: 'The saved question bank has changed. Reload it before saving.' });
        }
        if (!comparison.rows[0].valid) {
            await client.query('ROLLBACK');
            return res.status(400).json({ code: 'invalid_definition', message: 'The question definition is invalid.' });
        }
        let question = current.rows[0];
        if (!comparison.rows[0].unchanged) {
            const saved = question ? await client.query('UPDATE question SET definition = $1 WHERE id = $2 RETURNING id, definition',
                [req.body.definition, question.id]) : await client.query('INSERT INTO question (course_id, definition) VALUES ($1, $2) RETURNING id, definition',
                [id, req.body.definition]);
            question = saved.rows[0];
            await writeLog(client, { actorType: 'admin', adminId: req.admin.id, courseId: id, event: 'course.questions_saved',
                details: { question_id: question.id, question_count: req.body.definition.questions.length } });
        }
        await client.query('COMMIT');
        res.json({ ...responseData(course, question), code: 'saved', message: 'Question bank saved.' });
    } catch (saveError) {
        if (client) await client.query('ROLLBACK');
        if (saveError.code === '55P03') {
            return res.status(409).json({ code: 'course_busy', message: 'This course is being updated. Try saving again shortly.' });
        }
        next(saveError);
    } finally {
        if (client) client.release();
    }
});

module.exports = router;
