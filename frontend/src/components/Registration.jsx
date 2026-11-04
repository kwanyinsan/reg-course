import { useEffect, useRef, useState } from 'react';
import QuestionFields from './QuestionFields';
import { courseText, feeCents, formatCourseDate, formatMoney } from '../course-utils';

const fields = { full_name: ['fullName', 150, 'name'], organisation: ['organisation', 200, 'organization'],
    job_title: ['jobTitle', 150, 'organization-title'], phone: ['phone', 8, 'tel-national'], email: ['email', 254, 'email'] };
const emptyPersonal = { salutation: '', full_name: '', organisation: '', job_title: '', phone: '', email: '', comments: '', consent_accepted: false };

function answerValue(bank, id) {
    return bank && Object.hasOwn(bank, id) ? bank[id] : undefined;
}

async function request(path, body, timeout = 15000, reviewToken) {
    const response = await fetch(`/api/application${path}`, { signal: AbortSignal.timeout(timeout),
        headers: { ...(reviewToken ? { 'X-Application-Review': reviewToken } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Requested-With': 'reg-course' }) },
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error('Application request failed.'), { code: data.code, status: response.status });
    return data;
}

function Summary({ definition, text, language, payment }) {
    return <aside className="application-summary" aria-labelledby="application-summary-heading">
        <h2 id="application-summary-heading">{text.applicationSummary}</h2>
        <ul>{definition.courses.map(function course(item) { return <li key={item.id}>
            <span>{item.code}<br />{courseText(item.title, language)}</span><strong>{formatMoney(feeCents(item.fee), language)}</strong>
        </li>; })}</ul>
        <p className="selection-total">{text.total}: {formatMoney(feeCents(definition.total), language)}</p>
        {Number(definition.total) === 0 ? <p>{text.freeApplication}</p> : payment ? <section className="acknowledgement-payment" aria-labelledby="application-payment-heading">
            <h3 id="application-payment-heading">{text.combinedPayment}</h3>
            <p role="status">{text[`payment_${payment.unavailable_reason ? 'unavailable' : payment.state}`]}</p>
            {payment.reference && <p>{text.paymentReference}: <strong>{payment.reference}</strong></p>}
            {payment.due_at && <p>{text.paymentDeadline}: {formatCourseDate(payment.due_at, language, true)}<br />{text.hongKongTime}</p>}
            {payment.paid_at && <p>{text.paidAt}: {formatCourseDate(payment.paid_at, language, true)}</p>}
            {payment.state === 'expired' && <p>{text.paymentExpiredNote}</p>}
            {payment.state === 'cancelled' && <p>{text.paymentCancelledNote}</p>}
            {payment.state === 'unavailable' && <p>{text.paymentNoRecord}</p>}
            {payment.unavailable_reason && <p>{payment.unavailable_reason === 'course_cancelled' ? text.paymentCourseCancelled : text.paymentAmountMismatch}</p>}
            {payment.access_url && <><p>{text.paymentLinkLifetime}</p><a className="button-link" href={payment.access_url}>{text.viewPayment}</a></>}
        </section> : <><p>{text.paymentReviewNote}</p><p>{text.paymentDeadline}: {formatCourseDate(definition.payment_deadline, language, true)}<br />{text.hongKongTime}</p></>}
    </aside>;
}

function Answers({ courses, answers, text, language }) {
    return courses.map(function course(item) { return <section className="course-section" key={item.id}>
        <h3>{item.code} — {courseText(item.title, language)}</h3>
        {!item.definition.questions.length ? <p>{text.noAdditionalQuestions}</p> : <dl className="admin-fields">
            {item.definition.questions.map(function answer(question) {
                const value = answerValue(answers[item.id], question.id);
                const display = question.type === 'text' ? value : (Array.isArray(value) ? value : [value])
                    .map(function label(id) { return courseText(question.options?.find(function match(option) { return option.id === id; })?.label, language); }).filter(Boolean).join(', ');
                return <div key={question.id}><dt>{courseText(question.label, language)}</dt><dd className="course-description">{display || text.notProvided}</dd></div>;
            })}
        </dl>}
    </section>; });
}

function PersonalDetails({ personal, text }) {
    return <dl className="admin-fields">
        {Object.entries({ salutation: ['salutation'], ...fields, comments: ['comments'] }).map(function detail([key, [label]]) {
            return <div key={key}><dt>{text[label]}</dt><dd className="course-description">{personal[key] || text.notProvided}</dd></div>;
        })}
    </dl>;
}

function errorsFor(draft) {
    const personal = draft.personal;
    const errors = [];
    if (!['Mr', 'Ms', 'Miss'].includes(personal.salutation) || Object.entries(fields).some(function invalid([key, [, limit]]) {
        return !personal[key].trim() || personal[key].length > limit;
    }) || !/^\d{8}$/.test(personal.phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personal.email.trim()) || personal.comments.length > 2000) errors.push('invalidPersonal');
    if (draft.definition.courses.some(function incomplete(course) {
        return course.definition.questions.some(function invalid(question) {
            const value = answerValue(draft.answers[course.id], question.id);
            return (question.required && (value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length))) ||
                (question.type === 'text' && typeof value === 'string' && value.length > 1000);
        });
    })) errors.push('answerRequired');
    if (!personal.consent_accepted) errors.push('consentRequired');
    return errors;
}

function cleanAnswers(draft) {
    return Object.fromEntries(draft.definition.courses.map(function course(item) {
        return [item.id, Object.fromEntries(item.definition.questions.filter(function answered(question) {
            const value = answerValue(draft.answers[item.id], question.id);
            return value != null && value !== '' && (!Array.isArray(value) || value.length);
        }).map(function entry(question) { return [question.id, draft.answers[item.id][question.id]]; }))];
    }));
}

function Registration({ page, text, language, initialSelectedIds, draft, onDraftChange, onCompleted, onNotice }) {
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [errors, setErrors] = useState([]);
    const [reload, setReload] = useState(0);
    const pending = useRef(false);
    useEffect(function focusErrors() {
        if (errors.length) document.getElementById('application-errors')?.focus();
    }, [errors]);

    useEffect(function loadApplication() {
        if (draft?.receipt || (draft?.definition && page !== 'registration/acknowledgement')) return;
        let ignore = false;
        async function load() {
            setBusy(true);
            setNotice('');
            try {
                if (page === 'registration/acknowledgement') return setNotice(draft?.definition ? 'previousAcknowledgementUnavailable' : 'receiptUnavailable');
                if (!initialSelectedIds.length) return setNotice('applicationEmpty');
                const data = await request('/definition', { course_ids: initialSelectedIds });
                if (ignore) return;
                onDraftChange({ ...data, personal: draft?.personal || { ...emptyPersonal }, answers: draft?.answers || {} });
                window.location.replace('#registration');
            } catch (error) {
                if (!ignore) setNotice(error.code ? `applicationError_${error.code}` : 'applicationLoadError');
            } finally { if (!ignore) setBusy(false); }
        }
        load();
        return function ignoreOldResponse() { ignore = true; };
    }, [draft, initialSelectedIds, onDraftChange, onCompleted, page, reload]);

    async function showReceipt(receipt) {
        onDraftChange({ receipt });
        onCompleted();
        setNotice('');
        // Replace the workflow entry so Back leaves the completed application.
        window.location.replace('#registration/acknowledgement');
    }

    async function review(refreshOnly = false) {
        if (pending.current) return;
        const errors = errorsFor(draft);
        setErrors(errors);
        if (errors.length && !refreshOnly) {
            return;
        }
        pending.current = true;
        setBusy(true);
        setNotice('');
        try {
            const data = await request('/definition', { course_ids: draft.definition.courses.map(function id(course) { return course.id; }) });
            const changed = JSON.stringify(data.definition) !== JSON.stringify(draft.definition);
            onDraftChange({ ...draft, ...data, pendingPayload: null });
            if (changed || refreshOnly) {
                onNotice('applicationChanged');
                window.location.replace('#registration');
            } else window.location.replace('#registration/review');
        } catch (error) {
            if (error.code === 'application_completed') {
                try { await showReceipt((await request('/result', undefined, 15000, draft.review_token)).receipt); }
                catch { setNotice('applicationUnknown'); }
            } else setNotice(error.code ? `applicationError_${error.code}` : 'applicationLoadError');
        } finally { pending.current = false; setBusy(false); }
    }

    async function submit() {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setNotice('');
        const payload = draft.pendingPayload || { review_token: draft.review_token, personal: draft.personal, answers: cleanAnswers(draft) };
        onDraftChange({ ...draft, pendingPayload: payload });
        try {
            await showReceipt((await request('', payload, 30000)).receipt);
        } catch (error) {
            // A response may be lost after COMMIT. Read the browser-bound result first.
            try {
                const result = await request('/result', undefined, 15000, payload.review_token);
                await showReceipt(result.receipt);
            } catch {
                if (error.status && error.status < 500) {
                    onDraftChange({ ...draft, pendingPayload: null });
                    setNotice(error.code ? `applicationError_${error.code}` : 'applicationLoadError');
                } else setNotice('applicationUnknown');
            }
        } finally { pending.current = false; setBusy(false); }
    }

    async function startNew() {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        try {
            await request('/new', {});
            onDraftChange(null);
            // The old acknowledgement must not remain directly behind the new application.
            window.location.replace('#courses');
        } catch { setNotice('applicationLoadError'); }
        finally { pending.current = false; setBusy(false); }
    }

    function discard() {
        if (!busy && !draft.pendingPayload && window.confirm(text.confirmDiscardApplication)) startNew();
    }

    const receipt = draft?.receipt;
    const acknowledgementPage = page === 'registration/acknowledgement';
    const reviewPage = page === 'registration/review';
    const step = receipt || acknowledgementPage ? 2 : reviewPage ? 1 : 0;
    return <section className="application" aria-busy={busy}>
        <ol className="application-steps" aria-label={text.applicationTitle}>{text.applicationSteps.map(function label(label, index) {
            return <li key={label} aria-current={index === step ? 'step' : undefined}><span>{index + 1}</span>{label}</li>;
        })}</ol>
        {notice && <p className="feedback error" role="alert">{text[notice] || text.applicationLoadError}</p>}
        {busy && <p role="status">{text.applicationWorking}</p>}
        {(!draft?.definition || acknowledgementPage) && !receipt ? <>
            {!busy && !acknowledgementPage && <>{!notice && <p>{text.applicationLoading}</p>}<button type="button" onClick={function retry() { setReload(reload + 1); }}>{text.tryAgain}</button></>}
            <p><a href={acknowledgementPage ? '#courses' : '#selected'}>{acknowledgementPage ? text.backToCourses : text.reviewSelection}</a></p>
            {draft?.definition && <p><a href={draft.pendingPayload ? '#registration/review' : '#registration'}
                onClick={function returnToDraft() { setNotice(''); }}>{text.returnToApplication}</a></p>}
        </> : receipt ? <>
            <div className="application-received"><h2>{text.applicationReceived}</h2><p>{text.reference}: <strong>{receipt.submission.reference}</strong></p></div>
            <div className="application-columns"><div>
                <h2>{text.personalInformation}</h2><PersonalDetails personal={receipt.submission} text={text} />
                <h2>{text.courseAnswers}</h2><Answers courses={receipt.registrations.map(function course(item) { return { ...item, id: item.course_id }; })}
                    answers={Object.fromEntries(receipt.registrations.map(function answer(item) { return [item.course_id, item.answers]; }))} text={text} language={language} />
                <p>{text.receiptRecovery}</p>
                <button type="button" disabled={busy} onClick={startNew}>{text.newApplication}</button>
            </div><Summary definition={{ courses: receipt.registrations.map(function course(item) { return { ...item, id: item.course_id }; }), total: receipt.submission.total }} payment={receipt.payment} text={text} language={language} /></div>
        </> : <>
            <p>{reviewPage ? text.reviewBeforeSubmit : text.applicationIntro}</p>
            {!reviewPage && <p>{text.unsavedApplication}</p>}
            {errors.length > 0 && <div id="application-errors" className="feedback error" tabIndex="-1" role="alert"><p>{text.correctApplication}</p><ul>{errors.map(function error(key) { return <li key={key}>{text[key]}</li>; })}</ul></div>}
            <div className="application-columns"><div>
                {reviewPage ? <>
                    <h2>{text.personalInformation}</h2><PersonalDetails personal={draft.personal} text={text} />
                    <h2>{text.courseAnswers}</h2><Answers courses={draft.definition.courses} answers={draft.answers} text={text} language={language} />
                    <p>{text.applicationConsent}: {draft.personal.consent_accepted ? text.accepted : text.notAccepted}</p>
                    <div className="course-actions">
                        <button type="button" disabled={busy} onClick={submit}>{draft.pendingPayload ? text.retrySubmission : text.submitApplication}</button>
                        <button type="button" className="secondary-button" disabled={busy || !!draft.pendingPayload} onClick={function edit() { setNotice(''); window.location.replace('#registration'); }}>{text.editApplication}</button>
                        <button type="button" className="secondary-button" disabled={busy || !!draft.pendingPayload} onClick={discard}>{text.discardApplication}</button>
                    </div>
                    {notice && !draft.pendingPayload && <button type="button" className="secondary-button" disabled={busy} onClick={function refresh() { review(true); }}>{text.refreshApplication}</button>}
                </> : <form onSubmit={function reviewForm(event) { event.preventDefault(); review(); }}>
                    <fieldset disabled={busy || !!draft.pendingPayload} className="application-fields"><legend>{text.personalInformation}</legend>
                        <div className="application-field"><label htmlFor="application-salutation">{text.salutation} *</label>
                            <select id="application-salutation" required value={draft.personal.salutation} onChange={function change(event) { onDraftChange({ ...draft, personal: { ...draft.personal, salutation: event.target.value } }); }}>
                                <option value="">{text.selectSalutation}</option><option>Mr</option><option>Ms</option><option>Miss</option>
                            </select></div>
                        {Object.entries(fields).map(function field([key, [label, limit, autocomplete]]) {
                            return <div className="application-field" key={key}><label htmlFor={`application-${key}`}>{text[label]} *</label>
                                <input id={`application-${key}`} name={key} required type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
                                    autoComplete={autocomplete} maxLength={limit} pattern={key === 'phone' ? '[0-9]{8}' : undefined} inputMode={key === 'phone' ? 'numeric' : undefined}
                                    value={draft.personal[key]} onChange={function change(event) { onDraftChange({ ...draft, personal: { ...draft.personal, [key]: event.target.value } }); }} />
                                {key === 'phone' && <small>{text.eightDigitPhone}</small>}
                            </div>;
                        })}
                    </fieldset>
                    <fieldset disabled={busy || !!draft.pendingPayload} className="application-fields"><legend>{text.courseSpecificQuestions}</legend>
                        {draft.definition.courses.map(function course(item) { return <section className="course-section" key={item.id}>
                            <h3>{item.code} — {courseText(item.title, language)}</h3>
                            {!item.definition.questions.length ? <p>{text.noAdditionalQuestions}</p> : <QuestionFields namespace={`application-course-${item.id}`} questions={item.definition.questions}
                                answers={draft.answers[item.id] || {}} language={language} text={text} maxLength={1000}
                                onAnswerChange={function change(id, value) { onDraftChange({ ...draft, answers: { ...draft.answers, [item.id]: { ...draft.answers[item.id], [id]: value } } }); }} />}
                        </section>; })}
                        <div className="application-field"><label htmlFor="application-comments">{text.comments}</label><textarea id="application-comments" maxLength={2000} rows="4" value={draft.personal.comments}
                            onChange={function change(event) { onDraftChange({ ...draft, personal: { ...draft.personal, comments: event.target.value } }); }} /></div>
                        <section className="application-privacy"><h3>{text.privacyHeading}</h3><p>{text.privacyNotice}</p>
                            <label className="question-checkbox"><input type="checkbox" required checked={draft.personal.consent_accepted}
                                onChange={function consent(event) { onDraftChange({ ...draft, personal: { ...draft.personal, consent_accepted: event.target.checked } }); }} /><span>{text.applicationConsent} *</span></label>
                        </section>
                    </fieldset>
                    <div className="course-actions"><button type="submit" disabled={busy || !!draft.pendingPayload}>{text.reviewApplication}</button>
                        {!draft.pendingPayload && <a href="#selected">{text.changeCourses}</a>}
                        <button type="button" className="secondary-button" disabled={busy || !!draft.pendingPayload} onClick={discard}>{text.discardApplication}</button>
                    </div>
                    {draft.pendingPayload && <button type="button" disabled={busy} onClick={submit}>{text.retrySubmission}</button>}
                </form>}
            </div><Summary definition={draft.definition} text={text} language={language} /></div>
        </>}
    </section>;
}

export default Registration;
