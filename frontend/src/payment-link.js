const prefix = 'reg-course.payment.';
const memory = new Map();

export function capturePaymentLink() {
    if (window.location.hash.startsWith('#payment/')) {
        const token = window.location.hash.slice(9);
        const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), function hex(value) { return value.toString(16).padStart(2, '0'); }).join('');
        if (token.length <= 768 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) {
            memory.set(key, token);
            try { sessionStorage.setItem(prefix + key, token); }
            catch { /* Access remains available in memory during this visit. */ }
        }
        window.history.replaceState({ ...window.history.state, paymentKey: key }, '', '#payment');
    }
    return window.history.state?.paymentKey || 'invalid';
}

export function paymentToken(key) {
    try { return sessionStorage.getItem(prefix + key) || memory.get(key) || ''; }
    catch { return memory.get(key) || ''; }
}

export function clearPaymentToken(key) {
    memory.delete(key);
    try { sessionStorage.removeItem(prefix + key); }
    catch { /* The in-memory token has already been removed. */ }
}
