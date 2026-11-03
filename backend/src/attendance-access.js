const crypto = require('node:crypto');

function fail(code, status = 400) {
    throw Object.assign(new Error('Attendance request could not be completed.'), { code, status });
}

function configuration() {
    const secret = process.env.ATTENDANCE_LINK_SECRET;
    let origin;
    try { origin = new URL(process.env.APP_ORIGIN); } catch { fail('attendance_unavailable', 503); }
    if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret) || Buffer.from(secret, 'base64url').length !== 32 ||
        Buffer.from(secret, 'base64url').toString('base64url') !== secret || origin.origin !== process.env.APP_ORIGIN ||
        !['http:', 'https:'].includes(origin.protocol) || (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:')) fail('attendance_unavailable', 503);
    return { secret: Buffer.from(secret, 'base64url'), origin: origin.origin };
}

function sign(purpose, round, registrationId, now = Date.now()) {
    const expires = new Date(round.closes_at).getTime();
    const claims = { version: 1, purpose, round_id: round.id, course_id: round.course_id, session_id: round.session_id,
        registration_id: registrationId, expires_at: purpose === 'attendance_qr' ? Math.min(expires, now + 90000) : expires };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = crypto.createHmac('sha256', configuration().secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function verify(value, purpose, now = Date.now()) {
    if (typeof value !== 'string' || value.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) fail('attendance_link_invalid', 401);
    const [payload, signature] = value.split('.');
    const actual = Buffer.from(signature, 'base64url');
    const expected = crypto.createHmac('sha256', configuration().secret).update(payload).digest();
    if (actual.length !== expected.length || actual.toString('base64url') !== signature || !crypto.timingSafeEqual(actual, expected)) fail('attendance_link_invalid', 401);
    let claims;
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { fail('attendance_link_invalid', 401); }
    if (!claims || Array.isArray(claims) || Object.keys(claims).sort().join(',') !== 'course_id,expires_at,purpose,registration_id,round_id,session_id,version' ||
        claims.version !== 1 || claims.purpose !== purpose || !Number.isInteger(claims.course_id) || claims.course_id < 1 || claims.course_id > 2147483647 ||
        !Number.isInteger(claims.round_id) || claims.round_id < 1 || claims.round_id > 2147483647 ||
        typeof claims.session_id !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(claims.session_id) ||
        (purpose === 'attendance_student' ? !Number.isInteger(claims.registration_id) || claims.registration_id < 1 || claims.registration_id > 2147483647 : claims.registration_id !== null) ||
        !Number.isSafeInteger(claims.expires_at)) fail('attendance_link_invalid', 401);
    if (now >= claims.expires_at) fail('attendance_link_expired', 410);
    return claims;
}

function studentLink(round, registrationId) {
    return `${configuration().origin}/#attendance/${sign('attendance_student', round, registrationId)}`;
}

module.exports = { fail, configuration, sign, verify, studentLink };
