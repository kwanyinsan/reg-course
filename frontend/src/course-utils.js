const locales = { en: 'en-GB', 'zh-Hant': 'zh-Hant-HK', 'zh-Hans': 'zh-Hans-CN' };

export function courseText(value, language) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    if (typeof value[language] === 'string' && value[language].trim()) return value[language];
    return typeof value.en === 'string' ? value.en : '';
}

export function formatCourseDate(value, language, includeTime = false) {
    if (!value) return '';
    const options = { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: 'short', day: 'numeric' };
    if (includeTime) Object.assign(options, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return new Intl.DateTimeFormat(locales[language], options).format(new Date(value));
}

export function feeCents(value) {
    const [whole, fraction] = value.split('.');
    return Number(whole) * 100 + Number(fraction);
}

export function formatMoney(cents, language) {
    return new Intl.NumberFormat(locales[language], {
        style: 'currency', currency: 'HKD', currencyDisplay: 'code',
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(cents / 100);
}

export function readSelectedIds() {
    try {
        const saved = JSON.parse(localStorage.getItem('reg-course.selectedCourseIds') || '[]');
        if (Array.isArray(saved)) {
            return [...new Set(saved.filter(function validId(id) {
                return Number.isInteger(id) && id > 0 && id <= 2147483647;
            }))];
        }
    } catch {
        // Invalid or unavailable storage must not prevent public browsing.
    }
    return [];
}
