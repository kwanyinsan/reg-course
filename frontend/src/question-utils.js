export function newFieldId(prefix) {
    return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function emptyOption() {
    return { id: newFieldId('o'), label: { en: '' } };
}

export function cleanDefinition(definition) {
    function label(value) {
        const result = { en: value.en?.trim() || '' };
        for (const language of ['zh-Hant', 'zh-Hans']) {
            if (value[language]?.trim()) result[language] = value[language].trim();
        }
        return result;
    }
    return { questions: definition.questions.map(function cleanQuestion(question) {
        const result = { id: question.id, label: label(question.label), type: question.type, required: question.required };
        if (question.type !== 'text') result.options = question.options.map(function cleanOption(option) {
            return { id: option.id, label: label(option.label) };
        });
        return result;
    }) };
}

export function questionDraftDirty(draft) {
    return Boolean(draft && JSON.stringify(cleanDefinition(draft.definition)) !==
        JSON.stringify(cleanDefinition(draft.originalDefinition || { questions: [] })));
}

export function validateQuestionDraft(definition) {
    if (new TextEncoder().encode(JSON.stringify(definition)).length > 96 * 1024) return { code: 'definition_too_large' };
    if (definition.questions.length > 20) return { code: 'question_limit' };
    function labelError(label, field, maximum) {
        if (!label.en) return { code: 'english_label_required', field: `${field}.en` };
        for (const [language, value] of Object.entries(label)) {
            if (value.length > maximum) return { code: 'label_too_long', field: `${field}.${language}` };
        }
        return null;
    }
    for (const [index, question] of definition.questions.entries()) {
        const field = `questions.${index}`;
        const error = labelError(question.label, `${field}.label`, 300);
        if (error) return error;
        if (question.type !== 'text') {
            if (!question.options.length) return { code: 'option_required', field: `${field}.options` };
            if (question.options.length > 20) return { code: 'option_limit', field: `${field}.options` };
            for (const [optionIndex, option] of question.options.entries()) {
                const optionError = labelError(option.label, `${field}.options.${optionIndex}.label`, 150);
                if (optionError) return optionError;
            }
        }
    }
    return null;
}
