const crypto = require('node:crypto');

function fail(code, status) {
    throw Object.assign(new Error('Payment access is unavailable.'), { code, status });
}

function configuration() {
    const secret = process.env.PAYMENT_LINK_SECRET;
    let origin;
    try { origin = new URL(process.env.APP_ORIGIN); }
    catch { fail('payment_unavailable', 503); }
    if (!secret || !/^[A-Za-z0-9_-]{43}$/.test(secret) || Buffer.from(secret, 'base64url').length !== 32 ||
        Buffer.from(secret, 'base64url').toString('base64url') !== secret ||
        !['http:', 'https:'].includes(origin.protocol) || origin.origin !== process.env.APP_ORIGIN ||
        (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:')) fail('payment_unavailable', 503);
    return { secret: Buffer.from(secret, 'base64url'), origin: origin.origin };
}

function accessLink(payment) {
    if (!payment.id || new Date(payment.due_at).getTime() <= Date.now()) return null;
    const config = configuration();
    const claims = { version: 1, purpose: 'payment', payment_id: payment.id,
        not_before: new Date(payment.created_at).getTime(), expires_at: new Date(payment.due_at).getTime() };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = crypto.createHmac('sha256', config.secret).update(payload).digest('base64url');
    return `${config.origin}/#payment/${payload}.${signature}`;
}

function verifyAccess(value) {
    if (typeof value !== 'string' || value.length > 768 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) fail('payment_link_invalid', 401);
    const [payload, signature] = value.split('.');
    const actual = Buffer.from(signature, 'base64url');
    const expected = crypto.createHmac('sha256', configuration().secret).update(payload).digest();
    if (actual.length !== expected.length || actual.toString('base64url') !== signature || !crypto.timingSafeEqual(actual, expected)) fail('payment_link_invalid', 401);
    let claims;
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
    catch { fail('payment_link_invalid', 401); }
    if (!claims || Array.isArray(claims) || Object.keys(claims).sort().join(',') !== 'expires_at,not_before,payment_id,purpose,version' ||
        claims.version !== 1 || claims.purpose !== 'payment' || !Number.isInteger(claims.payment_id) || claims.payment_id < 1 || claims.payment_id > 2147483647 ||
        !Number.isSafeInteger(claims.not_before) || claims.not_before < 0 || !Number.isSafeInteger(claims.expires_at) ||
        claims.expires_at > 8640000000000000 || claims.expires_at <= claims.not_before || claims.not_before > Date.now()) fail('payment_link_invalid', 401);
    if (Date.now() >= claims.expires_at) fail('payment_link_expired', 410);
    return claims;
}

function validatePayment(claims, payment) {
    if (claims.payment_id !== payment.id || claims.not_before !== new Date(payment.created_at).getTime() ||
        claims.expires_at !== new Date(payment.due_at).getTime()) fail('payment_link_invalid', 401);
}

module.exports = { configuration, accessLink, verifyAccess, validatePayment };
