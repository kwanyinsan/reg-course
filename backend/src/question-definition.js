const definitionLimit = 96 * 1024;

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, required = allowed) {
    return isObject(value) && Object.keys(value).every(function supported(key) { return allowed.includes(key); }) &&
        required.every(function present(key) { return Object.hasOwn(value, key); });
}

function validateDefinition(definition) {
    function invalid(code, field = '') { return { code, field }; }
    if (!exactKeys(definition, ['questions']) || !Array.isArray(definition.questions)) return invalid('invalid_definition');
    if (Buffer.byteLength(JSON.stringify(definition), 'utf8') > definitionLimit) return invalid('definition_too_large');
    if (definition.questions.length > 20) return invalid('question_limit');
    const questionIds = new Set();

    function labelError(label, field, maximum) {
        if (!isObject(label) || Object.keys(label).some(function unsupported(key) { return !['en', 'zh-Hant', 'zh-Hans'].includes(key); })) {
            return invalid('invalid_definition', field);
        }
        if (typeof label.en !== 'string' || !label.en.trim()) return invalid('english_label_required', `${field}.en`);
        for (const [language, value] of Object.entries(label)) {
            if (typeof value !== 'string' || !value.trim()) return invalid('invalid_label', `${field}.${language}`);
            if (value.length > maximum) return invalid('label_too_long', `${field}.${language}`);
        }
        return null;
    }

    function validId(id) { return typeof id === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(id); }
    for (const [index, question] of definition.questions.entries()) {
        const field = `questions.${index}`;
        if (!exactKeys(question, ['id', 'label', 'type', 'required', 'options'], ['id', 'label', 'type', 'required']) ||
            !validId(question.id) || questionIds.has(question.id) || typeof question.required !== 'boolean' ||
            !['text', 'single_choice', 'multiple_choice'].includes(question.type)) return invalid('invalid_definition', field);
        questionIds.add(question.id);
        const error = labelError(question.label, `${field}.label`, 300);
        if (error) return error;
        if (question.type === 'text') {
            if (Object.hasOwn(question, 'options')) return invalid('invalid_definition', field);
            continue;
        }
        if (!Array.isArray(question.options) || question.options.length === 0) return invalid('option_required', `${field}.options`);
        if (question.options.length > 20) return invalid('option_limit', `${field}.options`);
        const optionIds = new Set();
        for (const [optionIndex, option] of question.options.entries()) {
            const optionField = `${field}.options.${optionIndex}`;
            if (!exactKeys(option, ['id', 'label']) || !validId(option.id) || optionIds.has(option.id)) return invalid('invalid_definition', optionField);
            optionIds.add(option.id);
            const optionError = labelError(option.label, `${optionField}.label`, 150);
            if (optionError) return optionError;
        }
    }
    return null;
}

function questionLockReason(course) {
    if (course.published_at) return 'published';
    if (course.state !== 'draft') return 'not_draft';
    if (course.total_registrations > 0) return 'has_registrations';
    return null;
}

module.exports = { validateDefinition, questionLockReason, exactKeys };
