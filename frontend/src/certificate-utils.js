export const certificateSections = ['heading', 'body', 'footer'];
export const certificatePlaceholders = ['participant_name', 'course_title', 'course_code', 'certificate_number', 'issued_date'];
export const certificateLimits = { heading: 200, body: 2000, footer: 500 };

export function cleanCertificate(template) {
    return Object.fromEntries(certificateSections.map(function clean(section) {
        return [section, { en: (template[section]?.en || '').replace(/\r\n?/g, '\n').trim() }];
    }));
}

export function certificateDraftDirty(draft) {
    if (!draft?.template) return false;
    const cleaned = cleanCertificate(draft.template);
    const original = draft.originalTemplate || draft.starter;
    return certificateSections.some(function changed(section) { return cleaned[section].en !== original?.[section]?.en; });
}

export function validateCertificate(template) {
    for (const section of certificateSections) {
        const value = template[section].en;
        if (!value.trim()) return { code: 'english_required', field: section };
        if (value.length > certificateLimits[section]) return { code: 'wording_too_long', field: section };
        const remaining = certificatePlaceholders.reduce(function remove(text, token) { return text.replaceAll(`{{${token}}}`, ''); }, value);
        if (remaining.includes('{{') || remaining.includes('}}')) return { code: 'unknown_placeholder', field: section };
    }
    return null;
}
