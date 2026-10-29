const express = require('express');
const pool = require('./db');
const { courseSummary, publicInformation } = require('./courses');

const router = express.Router();
const pageSize = 25;

function positiveInteger(value) {
    return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647;
}

function readFilters(req, res, kind) {
    const allowed = kind === 'courses' ? ['q', 'state', 'mode', 'page'] : ['q', 'state', 'payment_state', 'course_id', 'page'];
    const query = req.query;
    if (Object.keys(query).some(function invalidKey(key) { return !allowed.includes(key) || typeof query[key] !== 'string'; }) ||
        (query.q && query.q.length > 100) || (query.page && !positiveInteger(query.page)) ||
        (query.course_id && !positiveInteger(query.course_id)) ||
        (query.mode && !['in_person', 'virtual', 'hybrid'].includes(query.mode)) ||
        (query.state && !(kind === 'courses' ? ['draft', 'published', 'archived'] : ['registered', 'cancelled']).includes(query.state)) ||
        (query.payment_state && !['pending', 'paid', 'expired', 'cancelled', 'none'].includes(query.payment_state))) {
        res.status(400).json({ message: 'Provide valid search, filter and pagination values.' });
        return null;
    }
    return { ...query, q: query.q?.trim() || '', page: Number(query.page || 1) };
}

function readId(req, res) {
    if (!positiveInteger(req.params.id) || Object.keys(req.query).length) {
        res.status(400).json({ message: 'Provide a positive integer ID without query parameters.' });
        return null;
    }
    return Number(req.params.id);
}

function addCondition(conditions, values, column, value) {
    values.push(value);
    conditions.push(`${column} = $${values.length}`);
}

function searchValue(value) {
    return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

async function readTransaction(read) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await read(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function readPage(countSql, rowsSql, values, page) {
    return readTransaction(async function readList(client) {
        const count = await client.query(countSql, values);
        const result = await client.query(rowsSql + ` LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
            [...values, pageSize, (page - 1) * pageSize]);
        return { records: result.rows, page, page_size: pageSize, total: count.rows[0].total };
    });
}

const countColumns = `(SELECT COUNT(*)::int FROM registration r WHERE r.course_id = c.id) AS total_registrations,
    (SELECT COUNT(*)::int FROM registration r WHERE r.course_id = c.id AND r.state = 'registered') AS registered_count,
    (SELECT COUNT(*)::int FROM registration r WHERE r.course_id = c.id AND r.state = 'cancelled') AS cancelled_count`;

router.get('/courses', async function listCourses(req, res, next) {
    const filters = readFilters(req, res, 'courses');
    if (!filters) return;
    const conditions = [];
    const values = [];
    if (filters.state) addCondition(conditions, values, 'c.state', filters.state);
    if (filters.mode) addCondition(conditions, values, 'c.mode', filters.mode);
    if (filters.q) {
        values.push(searchValue(filters.q));
        const value = `$${values.length}`;
        conditions.push(`(c.code ILIKE ${value} OR c.title->>'en' ILIKE ${value}
            OR c.title->>'zh-Hant' ILIKE ${value} OR c.title->>'zh-Hans' ILIKE ${value})`);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    try {
        const result = await readPage(`SELECT COUNT(*)::int AS total FROM course c${where}`,
            `SELECT c.id, c.code, c.title, c.short_description, c.sessions, c.mode, c.fee, c.state,
                    c.registration_opens_at, c.registration_closes_at, c.payment_deadline, ${countColumns}
             FROM course c${where} ORDER BY c.code, c.id`, values, filters.page);
        const now = Date.now();
        res.json({ courses: result.records.map(function summarize(course) {
            return { ...courseSummary(course, now), state: course.state,
                total_registrations: course.total_registrations, registered_count: course.registered_count,
                cancelled_count: course.cancelled_count };
        }), page: result.page, page_size: result.page_size, total: result.total });
    } catch (error) { next(error); }
});

router.get('/courses/:id', async function courseDetails(req, res, next) {
    const id = readId(req, res);
    if (!id) return;
    try {
        const result = await pool.query(
            `SELECT c.id, c.code, c.title, c.short_description, c.long_description, c.information,
                    c.sessions, c.mode, c.fee, c.state, c.attendance_requirement_percent,
                    c.registration_opens_at, c.registration_closes_at, c.payment_deadline, ${countColumns}
             FROM course c WHERE c.id = $1`, [id]);
        const course = result.rows[0];
        if (!course) return res.status(404).json({ message: 'Course not found.' });
        res.json({ course: { ...courseSummary(course, Date.now()), state: course.state,
            long_description: course.long_description, information: publicInformation(course.information),
            sessions: course.sessions, attendance_requirement_percent: course.attendance_requirement_percent,
            total_registrations: course.total_registrations, registered_count: course.registered_count,
            cancelled_count: course.cancelled_count } });
    } catch (error) { next(error); }
});

router.get('/registrations', async function listRegistrations(req, res, next) {
    const filters = readFilters(req, res, 'registrations');
    if (!filters) return;
    const conditions = [];
    const values = [];
    if (filters.course_id) addCondition(conditions, values, 'r.course_id', Number(filters.course_id));
    if (filters.state) addCondition(conditions, values, 'r.state', filters.state);
    if (filters.payment_state === 'none') conditions.push('p.id IS NULL');
    else if (filters.payment_state) addCondition(conditions, values, 'p.state', filters.payment_state);
    if (filters.q) {
        values.push(searchValue(filters.q));
        const value = `$${values.length}`;
        conditions.push(`(s.full_name ILIKE ${value} OR s.email ILIKE ${value} OR s.phone ILIKE ${value}
            OR s.reference ILIKE ${value} OR c.code ILIKE ${value} OR r.id::text ILIKE ${value}
            OR c.title->>'en' ILIKE ${value} OR c.title->>'zh-Hant' ILIKE ${value} OR c.title->>'zh-Hans' ILIKE ${value})`);
    }
    const from = ` FROM registration r JOIN submission s ON s.id = r.submission_id
        JOIN course c ON c.id = r.course_id LEFT JOIN payment p ON p.submission_id = s.id`;
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    try {
        const result = await readPage(`SELECT COUNT(*)::int AS total${from}${where}`,
            `SELECT r.id, r.submission_id, s.reference AS submission_reference, s.full_name, s.email, s.phone,
                    r.course_id, c.code, c.title, r.fee, r.created_at, r.state, p.state AS payment_state
             ${from}${where} ORDER BY r.created_at DESC, r.id DESC`, values, filters.page);
        res.json({ registrations: result.records, page: result.page, page_size: result.page_size, total: result.total });
    } catch (error) { next(error); }
});

router.get('/registrations/:id', async function registrationDetails(req, res, next) {
    const id = readId(req, res);
    if (!id) return;
    try {
        const result = await readTransaction(async function readDetails(client) {
            const record = await client.query(
                `SELECT jsonb_build_object('id', r.id, 'submission_id', r.submission_id, 'course_id', r.course_id,
                        'fee', r.fee::text, 'state', r.state, 'answers', r.answers, 'attendance', r.attendance,
                        'created_at', r.created_at, 'cancelled_at', r.cancelled_at, 'cancelled_by', ra.username,
                        'cancellation_reason', r.cancellation_reason, 'certificate_number', r.certificate_number,
                        'certificate_issued_at', r.certificate_issued_at) AS registration,
                        jsonb_build_object('id', s.id, 'reference', s.reference, 'salutation', s.salutation,
                        'full_name', s.full_name, 'organisation', s.organisation, 'job_title', s.job_title,
                        'phone', s.phone, 'email', s.email, 'comments', s.comments, 'consent_accepted', s.consent_accepted,
                        'total', s.total::text, 'created_at', s.created_at, 'is_cancelled', s.is_cancelled,
                        'cancelled_at', s.cancelled_at, 'cancelled_by', sa.username, 'cancellation_reason', s.cancellation_reason) AS submission,
                        jsonb_build_object('id', c.id, 'code', c.code, 'title', c.title, 'mode', c.mode,
                        'sessions', c.sessions, 'attendance_requirement_percent', c.attendance_requirement_percent) AS course,
                        CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('reference', p.reference,
                        'amount', p.amount::text, 'state', p.state, 'due_at', p.due_at, 'paid_at', p.paid_at) END AS payment,
                        q.definition AS questions
                 FROM registration r JOIN submission s ON s.id = r.submission_id JOIN course c ON c.id = r.course_id
                 LEFT JOIN payment p ON p.submission_id = s.id LEFT JOIN question q ON q.course_id = c.id
                 LEFT JOIN admin ra ON ra.id = r.cancelled_by LEFT JOIN admin sa ON sa.id = s.cancelled_by
                 WHERE r.id = $1`, [id]);
            if (!record.rowCount) return null;
            const details = record.rows[0];
            const related = await client.query(
                `SELECT r.id, r.course_id, c.code, c.title, r.fee, r.state FROM registration r
                 JOIN course c ON c.id = r.course_id WHERE r.submission_id = $1 ORDER BY r.id`,
                [details.submission.id]);
            return { ...details, related_registrations: related.rows };
        });
        if (!result) return res.status(404).json({ message: 'Registration not found.' });
        res.json(result);
    } catch (error) { next(error); }
});

module.exports = router;
