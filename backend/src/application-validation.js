const crypto = require('node:crypto');

function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(code, status = 400) {
    const error = new Error(code);
    error.code = code;
    error.status = status;
    throw error;
}

function exactKeys(value, allowed) {
    if (!object(value) || Object.keys(value).some(function unknown(key) { return !allowed.includes(key); })) fail('invalid_request');
}

function courseIds(value) {
    if (!Array.isArray(value) || !value.length || value.length > 10 ||
        value.some(function invalid(id) { return !Number.isInteger(id) || id < 1 || id > 2147483647; }) ||
        new Set(value).size !== value.length) fail('invalid_courses');
    return [...value].sort(function ascending(a, b) { return a - b; });
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(function entry(key) { return [key, canonical(value[key])]; }));
    return value;
}

function fingerprint(value) {
    return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function validateApplication(body, definition) {
    exactKeys(body, ['review_token', 'personal', 'answers']);
    if (typeof body.review_token !== 'string' || body.review_token.length > 100) fail('invalid_request');
    exactKeys(body.personal, ['salutation', 'full_name', 'organisation', 'job_title', 'phone', 'email', 'comments', 'consent_accepted']);
    const personal = {};
    for (const [key, limit] of Object.entries({ salutation: 4, full_name: 150, organisation: 200, job_title: 150, phone: 8, email: 254, comments: 2000 })) {
        const value = body.personal[key] ?? (key === 'comments' ? '' : null);
        if (typeof value !== 'string' || value.length > limit || (key !== 'comments' && !value.trim())) fail('invalid_personal');
        personal[key] = value.trim();
    }
    if (!['Mr', 'Ms', 'Miss'].includes(personal.salutation) || !/^\d{8}$/.test(personal.phone) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personal.email)) fail('invalid_personal');
    if (body.personal.consent_accepted !== true) fail('consent_required');
    personal.consent_accepted = true;
    exactKeys(body.answers, definition.courses.map(function id(course) { return String(course.id); }));
    if (Buffer.byteLength(JSON.stringify(body.answers), 'utf8') > 96 * 1024) fail('answers_too_large');
    const answers = {};
    for (const course of definition.courses) {
        const given = body.answers[course.id] ?? {};
        exactKeys(given, course.definition.questions.map(function id(question) { return question.id; }));
        const entries = [];
        for (const question of course.definition.questions) {
            const value = Object.hasOwn(given, question.id) ? given[question.id] : undefined;
            const empty = value == null || value === '' || (question.type === 'multiple_choice' && Array.isArray(value) && !value.length);
            if (empty) {
                if (question.required) fail('required_answer');
                continue;
            }
            if (question.type === 'text') {
                if (typeof value !== 'string' || value.length > 1000 || (question.required && !value.trim())) fail('invalid_answer');
                if (value.trim()) entries.push([question.id, value]);
            } else {
                const options = question.options.map(function id(option) { return option.id; });
                if (question.type === 'single_choice') {
                    if (typeof value !== 'string' || !options.includes(value)) fail('invalid_answer');
                    entries.push([question.id, value]);
                } else {
                    if (!Array.isArray(value) || new Set(value).size !== value.length ||
                        value.some(function unknown(id) { return typeof id !== 'string' || !options.includes(id); })) fail('invalid_answer');
                    entries.push([question.id, options.filter(function chosen(id) { return value.includes(id); })]);
                }
            }
        }
        answers[course.id] = Object.fromEntries(entries);
    }
    return { review_token: body.review_token, personal, answers };
}

module.exports = { object, fail, exactKeys, courseIds, fingerprint, validateApplication };
