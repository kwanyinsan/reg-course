const sections = ['heading', 'body', 'footer'];
const placeholders = ['participant_name', 'course_title', 'course_code', 'certificate_number', 'issued_date'];
const limits = { heading: 200, body: 2000, footer: 500 };
const starter = {
    heading: { en: 'Certificate' },
    body: { en: '{{participant_name}}\n\n{{course_title}}\nCourse code: {{course_code}}' },
    footer: { en: 'Certificate number: {{certificate_number}}\nIssued date: {{issued_date}}' },
};

function exactKeys(value, keys) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).length === keys.length && keys.every(function present(key) { return Object.hasOwn(value, key); });
}

function validateTemplate(template) {
    if (!exactKeys(template, sections)) return { code: 'invalid_template' };
    if (Buffer.byteLength(JSON.stringify(template), 'utf8') > 32 * 1024) return { code: 'template_too_large' };
    for (const section of sections) {
        if (!exactKeys(template[section], ['en'])) return { code: 'english_only', field: section };
        const value = template[section].en;
        if (typeof value !== 'string' || !value.trim()) return { code: 'english_required', field: section };
        if (value.length > limits[section]) return { code: 'wording_too_long', field: section };
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return { code: 'invalid_text', field: section };
        const remaining = value.replace(/{{(participant_name|course_title|course_code|certificate_number|issued_date)}}/g, '');
        if (remaining.includes('{{') || remaining.includes('}}')) return { code: 'unknown_placeholder', field: section };
    }
    return null;
}

function lockReason(course) {
    if (course.published_at) return 'published';
    return course.state === 'draft' ? null : 'not_draft';
}

module.exports = { sections, placeholders, limits, starter, exactKeys, validateTemplate, lockReason };
