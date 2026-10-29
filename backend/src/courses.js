const express = require('express');
const pool = require('./db');

const router = express.Router();

function availability(course, now) {
    if (now >= new Date(course.payment_deadline).getTime() ||
        (course.registration_closes_at && now >= new Date(course.registration_closes_at).getTime())) {
        return 'closed';
    }
    if (course.registration_opens_at && now < new Date(course.registration_opens_at).getTime()) {
        return 'upcoming';
    }
    return 'open';
}

function validTranslations(value) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
        typeof value.en === 'string' && value.en.trim() &&
        Object.entries(value).every(function validEntry([key, text]) {
            return ['en', 'zh-Hant', 'zh-Hans'].includes(key) && typeof text === 'string' && text.trim();
        });
}

function publicInformation(information) {
    const result = {};
    for (const key of ['venue', 'audience', 'prerequisites', 'teaching_language']) {
        if (validTranslations(information[key])) result[key] = information[key];
    }
    if (Array.isArray(information.learning_outcomes)) {
        const outcomes = information.learning_outcomes.filter(validTranslations);
        if (outcomes.length) result.learning_outcomes = outcomes;
    }
    return result;
}

function courseSummary(course, now) {
    return {
        id: course.id,
        code: course.code,
        title: course.title,
        short_description: course.short_description,
        mode: course.mode,
        fee: course.fee,
        registration_opens_at: course.registration_opens_at,
        registration_closes_at: course.registration_closes_at,
        payment_deadline: course.payment_deadline,
        starts_at: course.sessions[0].starts_at,
        ends_at: course.sessions[course.sessions.length - 1].ends_at,
        session_count: course.sessions.length,
        availability: availability(course, now),
    };
}

router.use(function validateQuery(req, res, next) {
    if (Object.keys(req.query).length) {
        return res.status(400).json({ message: 'Course endpoints do not accept query parameters.' });
    }
    next();
});

router.get('/', async function listCourses(req, res, next) {
    try {
        const result = await pool.query(
            `SELECT id, code, title, short_description, mode, fee, sessions,
                    registration_opens_at, registration_closes_at, payment_deadline
             FROM course WHERE state = $1 ORDER BY code, id`,
            ['published']
        );
        const now = Date.now();
        res.json({ courses: result.rows.map(function summarize(course) {
            return courseSummary(course, now);
        }), server_time: new Date(now).toISOString() });
    } catch (error) {
        next(error);
    }
});

router.get('/:id', async function courseDetails(req, res, next) {
    const id = Number(req.params.id);
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isInteger(id) || id > 2147483647) {
        return res.status(400).json({ message: 'Course ID must be a positive integer.' });
    }
    try {
        const result = await pool.query(
            `SELECT id, code, title, short_description, long_description, information,
                    mode, fee, sessions, registration_opens_at, registration_closes_at,
                    payment_deadline, attendance_requirement_percent
             FROM course WHERE state = $1 AND id = $2`,
            ['published', id]
        );
        const course = result.rows[0];
        if (!course) return res.status(404).json({ message: 'Course not found.' });
        const now = Date.now();
        res.json({ course: {
            ...courseSummary(course, now),
            long_description: course.long_description,
            information: publicInformation(course.information),
            sessions: course.sessions,
            attendance_requirement_percent: course.attendance_requirement_percent,
        }, server_time: new Date(now).toISOString() });
    } catch (error) {
        next(error);
    }
});

module.exports = { router, availability, publicInformation, courseSummary };
