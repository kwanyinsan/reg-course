import { useEffect, useRef, useState } from 'react';
import { courseText, feeCents, formatCourseDate, formatMoney } from '../course-utils';
import { clearPaymentToken, paymentToken } from '../payment-link';

async function request(key, pay = false) {
    const token = paymentToken(key);
    if (!token) throw Object.assign(new Error('Payment link is unavailable.'), { code: 'payment_link_invalid' });
    const response = await fetch(`/api/payment${pay ? '/pay' : ''}`, {
        credentials: 'omit', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, ...(pay ? { 'Content-Type': 'application/json', 'X-Requested-With': 'reg-course' } : {}) },
        ...(pay ? { method: 'POST', body: '{}' } : {}),
    });
    const data = await response.json();
    if (!response.ok && !data.payment) throw Object.assign(new Error('Payment request failed.'), { code: data.code });
    return { ...data, ok: response.ok };
}

function Payment({ accessKey, text, language, onNotice }) {
    const [result, setResult] = useState({ status: 'loading', payment: null, code: '' });
    const [busy, setBusy] = useState(false);
    const [unconfirmed, setUnconfirmed] = useState(false);
    const [notice, setNotice] = useState('');
    const pending = useRef(false);
    const latest = useRef(0);

    useEffect(function loadPayment() {
        let ignore = false;
        const version = ++latest.current;
        async function load() {
            try {
                const data = await request(accessKey);
                if (!ignore && version === latest.current) setResult({ status: 'ready', payment: data.payment, code: '' });
            } catch (error) {
                if (['payment_link_invalid', 'payment_link_expired'].includes(error.code)) clearPaymentToken(accessKey);
                if (!ignore && version === latest.current) setResult({ status: 'error', payment: null, code: error.code || '' });
            }
        }
        load();
        return function ignoreOldResponse() { ignore = true; };
    }, [accessKey]);

    useEffect(function expireAccess() {
        const payment = result.payment;
        if (!payment) return;
        const expires = Date.now() + (new Date(payment.due_at) - new Date(payment.server_time));
        let timer;
        function wait() {
            const remaining = expires - Date.now();
            if (remaining > 0) timer = window.setTimeout(wait, Math.min(remaining, 2147483647));
            else {
                clearPaymentToken(accessKey);
                setResult({ status: 'error', payment: null, code: 'payment_link_expired' });
            }
        }
        timer = window.setTimeout(wait, Math.max(0, Math.min(expires - Date.now(), 2147483647)));
        return function clearExpiry() { window.clearTimeout(timer); };
    }, [accessKey, result.payment]);

    async function retryLoad() {
        if (pending.current) return;
        pending.current = true;
        ++latest.current;
        setBusy(true);
        try {
            const data = await request(accessKey);
            setResult({ status: 'ready', payment: data.payment, code: '' });
            setUnconfirmed(false);
            setNotice('');
        } catch (error) {
            if (['payment_link_invalid', 'payment_link_expired'].includes(error.code)) {
                clearPaymentToken(accessKey);
                setResult({ status: 'error', payment: null, code: error.code });
            } else {
                setNotice(error.code ? `paymentError_${error.code}` : 'paymentLoadError');
                onNotice('paymentLoadError', 'error');
            }
        } finally { pending.current = false; setBusy(false); }
    }

    useEffect(function refreshOnReturn() {
        async function refresh() {
            if (pending.current || !paymentToken(accessKey)) return;
            const version = ++latest.current;
            try {
                const data = await request(accessKey);
                if (version !== latest.current) return;
                setResult({ status: 'ready', payment: data.payment, code: '' });
                setUnconfirmed(false);
                setNotice('');
            } catch (error) {
                if (version !== latest.current) return;
                if (['payment_link_invalid', 'payment_link_expired'].includes(error.code)) {
                    clearPaymentToken(accessKey);
                    setResult({ status: 'error', payment: null, code: error.code });
                }
            }
        }
        window.addEventListener('focus', refresh);
        return function stopRefreshing() { window.removeEventListener('focus', refresh); };
    }, [accessKey]);

    async function pay() {
        if (pending.current || unconfirmed || !result.payment?.can_pay) return;
        pending.current = true;
        ++latest.current;
        setBusy(true);
        setNotice('');
        try {
            const data = await request(accessKey, true);
            setResult({ status: 'ready', payment: data.payment, code: '' });
            if (data.payment.state === 'paid') onNotice('paymentRecorded');
        } catch (error) {
            if (['payment_link_invalid', 'payment_link_expired'].includes(error.code)) {
                clearPaymentToken(accessKey);
                setResult({ status: 'error', payment: null, code: error.code });
            } else {
                setUnconfirmed(true);
                setNotice('paymentResultUnknown');
                // A lost response may follow COMMIT. Recover with GET, never an automatic second Pay.
                try {
                    const data = await request(accessKey);
                    setResult({ status: 'ready', payment: data.payment, code: '' });
                    setUnconfirmed(false);
                    setNotice('');
                    onNotice(data.payment.state === 'paid' ? 'paymentRecorded' : 'paymentStatusChecked');
                } catch (recoveryError) {
                    if (['payment_link_invalid', 'payment_link_expired'].includes(recoveryError.code)) {
                        clearPaymentToken(accessKey);
                        setResult({ status: 'error', payment: null, code: recoveryError.code });
                    }
                }
            }
        } finally { pending.current = false; setBusy(false); }
    }

    const payment = result.payment;
    const inaccessible = ['payment_link_invalid', 'payment_link_expired'].includes(result.code);
    const money = value => formatMoney(feeCents(value), language);
    return <section className="payment-page" aria-busy={busy}>
        {result.status === 'loading' ? <p role="status">{text.applicationLoading}</p> : !payment ? <>
            <p className="feedback error" role="alert">{text[`paymentError_${result.code}`] || text.paymentLoadError}</p>
            {!inaccessible && <button type="button" disabled={busy} onClick={retryLoad}>{text.tryAgain}</button>}
        </> : <>
            {payment.state === 'paid' ? <div className="application-received"><h2>{text.paymentRecorded}</h2><p>{text.paymentRecordedNote}</p></div>
                : <p>{text.paymentIntro}</p>}
            <dl className="payment-references">
                <div><dt>{text.applicationReference}</dt><dd>{payment.application_reference}</dd></div>
                <div><dt>{text.paymentReference}</dt><dd>{payment.reference}</dd></div>
            </dl>
            <div className="payment-columns"><section aria-labelledby="payment-courses-heading">
                <h2 id="payment-courses-heading">{text.selectedCourses}</h2>
                <ul className="payment-courses">{payment.courses.map(function course(item) { return <li key={item.code}>
                    <div><h3>{item.code} — {courseText(item.title, language)}</h3>
                        {item.sessions.map(function session(session) { return <p key={session.id}>
                            {formatCourseDate(session.starts_at, language, true)} – {formatCourseDate(session.ends_at, language, true)}
                        </p>; })}</div><strong>{money(item.fee)}</strong>
                </li>; })}</ul>
                <p>{text.hongKongTime}</p>
            </section><aside className="application-summary payment-summary" aria-labelledby="payment-summary-heading">
                <h2 id="payment-summary-heading">{text.paymentSummary}</h2>
                <dl className="admin-fields">
                    <div><dt>{text.paymentStatus}</dt><dd role="status">{text[`payment_${payment.unavailable_reason ? 'unavailable' : payment.state}`]}</dd></div>
                    <div><dt>{text.totalPayable}</dt><dd className="payment-total">{money(payment.amount)}</dd></div>
                    <div><dt>{text.paymentDeadline}</dt><dd>{formatCourseDate(payment.due_at, language, true)}</dd></div>
                    {payment.paid_at && <div><dt>{text.paidAt}</dt><dd>{formatCourseDate(payment.paid_at, language, true)}</dd></div>}
                </dl>
                {payment.unavailable_reason && <p>{payment.unavailable_reason === 'course_cancelled' ? text.paymentCourseCancelled : text.paymentAmountMismatch}</p>}
                {payment.state === 'expired' && <p>{text.paymentExpiredNote}</p>}
                {payment.state === 'cancelled' && <p>{text.paymentCancelledNote}</p>}
                {payment.can_pay && <p>{text.paymentInstructions}</p>}
                <p>{text.paymentLinkLifetime}</p>
                {notice && <p className="feedback error" role="alert">{text[notice] || text.paymentLoadError}</p>}
                {payment.can_pay && <div className="payment-actions">
                    <button type="button" disabled={busy || unconfirmed} onClick={pay}>{text.pay}</button>
                </div>}
            </aside></div>
        </>}
    </section>;
}

export default Payment;
