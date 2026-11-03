const prefix = 'reg-course.attendance.';
const memory = new Map();

export function captureAttendanceLink() {
    if (window.location.hash.startsWith('#attendance/')) {
        const token = window.location.hash.slice(12);
        const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
        if (token.length <= 1024 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) {
            memory.set(key, token);
            try { sessionStorage.setItem(prefix + key, token); } catch { /* This visit can continue in memory. */ }
        }
        window.history.replaceState({ ...window.history.state, attendanceKey: key }, '', '#attendance');
    }
    return window.history.state?.attendanceKey || 'invalid';
}

export function attendanceToken(key) {
    try { return sessionStorage.getItem(prefix + key) || memory.get(key) || ''; } catch { return memory.get(key) || ''; }
}

export async function attendanceRequest(path, method = 'GET', body, token) {
    const response = await fetch(`/api/${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'reg-course',
        ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error('Attendance request failed.'), { status: response.status, code: data.code || 'attendance_unavailable' });
    return data;
}

export function hkInput(value) {
    if (!value) return '';
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}
