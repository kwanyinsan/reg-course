import { useEffect, useState } from 'react';
import { courseText, feeCents, formatCourseDate, formatMoney } from '../course-utils';

function answerText(question, value, language, text) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return text.notProvided;
    if (question.type === 'text') return typeof value === 'string' ? value : text.notProvided;
    const values = Array.isArray(value) ? value : [value];
    return values.map(function optionLabel(id) {
        const option = question.options?.find(function match(option) { return option.id === id; });
        return courseText(option?.label, language) || text.notProvided;
    }).join(', ');
}

function StaffRegistrationDetails({ id, text, language, onSessionExpired }) {
    const [result, setResult] = useState({ id: null, status: 'loading' });
    const [refresh, setRefresh] = useState(0);
    useEffect(function loadRegistration() {
        let ignore = false;
        async function load() {
            try {
                const response = await fetch(`/api/staff/registrations/${id}`, { signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (ignore) return;
                if (response.status === 401) return onSessionExpired();
                if (!response.ok || !data.registration) return setResult({ id, status: 'error', message: response.status === 404 ? 'registrationUnavailable' : 'staffLoadError' });
                setResult({ id, status: 'ready', data });
            } catch {
                if (!ignore) setResult({ id, status: 'error', message: 'staffLoadError' });
            }
        }
        load();
        return function ignoreOldResponse() { ignore = true; };
    }, [id, refresh, onSessionExpired]);
    function date(value) { return value ? formatCourseDate(value, language, true) : text.notRecorded; }
    function money(value) { return formatMoney(feeCents(value), language); }
    function field(label, value, key = label) { return <div key={key}><dt>{label}</dt><dd className="course-description">{value || text.notProvided}</dd></div>; }
    if (result.id !== id || result.status === 'loading') return <p role="status">{text.loadingRegistrations}</p>;
    if (result.status === 'error') return <section><p role="alert">{text[result.message]}</p><button type="button" onClick={function retry() { setResult({ id, status: 'loading' }); setRefresh(refresh + 1); }}>{text.tryAgain}</button><p><a href="#staff/registrations">{text.backToRegistrations}</a></p></section>;
    const { registration, submission, course, payment, questions, related_registrations: related } = result.data;
    const bank = questions?.questions || [];
    return (
        <article className="staff-registration-details">
            <div className="course-actions"><a href="#staff/registrations">{text.backToRegistrations}</a><a href={`#staff/courses/${course.id}`}>{text.backToCourse}</a></div>
            <h2>{text.registration} #{registration.id}</h2>
            <p><a href={`#staff/courses/${course.id}`}>{course.code} — {courseText(course.title, language)}</a></p>
            <dl className="staff-fields">{field(text.registrationState, text[`state_${registration.state}`])}{field(text.registeredAt, date(registration.created_at))}{field(text.registrationFee, money(registration.fee))}</dl>
            <section className="course-section"><h2>{text.personalInformation}</h2>
                <dl className="staff-fields">
                    {field(text.salutation, submission.salutation)}{field(text.fullName, submission.full_name)}
                    {field(text.organisation, submission.organisation)}{field(text.jobTitle, submission.job_title)}
                    {field(text.phone, submission.phone)}{field(text.email, submission.email)}
                    {field(text.comments, submission.comments)}{field(text.consent, submission.consent_accepted ? text.accepted : text.notAccepted)}
                </dl>
            </section>
            <section className="course-section"><h2>{text.courseAnswers}</h2>
                {!bank.length ? <p>{text.noCourseQuestions}</p> : <dl className="staff-fields">{bank.map(function answer(question) {
                    return field(courseText(question.label, language) || text.question, answerText(question, registration.answers[question.id], language, text), question.id);
                })}</dl>}
            </section>
            <section className="course-section"><h2>{text.submission}</h2>
                <dl className="staff-fields">{field(text.reference, submission.reference)}{field(text.createdAt, date(submission.created_at))}{field(text.submissionTotal, money(submission.total))}{field(text.submissionState, submission.is_cancelled ? text.state_cancelled : text.notCancelled)}</dl>
                <h3>{text.relatedRegistrations}</h3>
                <ul className="staff-related">{related.map(function relatedRegistration(item) {
                    return <li key={item.id}><a href={`#staff/registrations/${item.id}`}>#{item.id} — {item.code} — {courseText(item.title, language)}</a><span>{money(item.fee)} — {text[`state_${item.state}`]}</span></li>;
                })}</ul>
            </section>
            <section className="course-section"><h2>{text.combinedPayment}</h2>
                <p>{text.combinedPaymentExplanation}</p>
                {!payment ? <p>{text.payment_none}</p> : <dl className="staff-fields">{field(text.reference, payment.reference)}{field(text.amount, money(payment.amount))}{field(text.paymentStatus, text[`payment_${payment.state}`])}{field(text.paymentDeadline, date(payment.due_at))}{field(text.paidAt, date(payment.paid_at))}</dl>}
            </section>
            {(registration.state === 'cancelled' || submission.is_cancelled) && <section className="course-section"><h2>{text.cancellation}</h2>
                {registration.state === 'cancelled' && <><h3>{text.registration}</h3><dl className="staff-fields">{field(text.cancelledAt, date(registration.cancelled_at))}{field(text.cancelledBy, registration.cancelled_by)}{field(text.cancellationReason, registration.cancellation_reason)}</dl></>}
                {submission.is_cancelled && <><h3>{text.submission}</h3><dl className="staff-fields">{field(text.cancelledAt, date(submission.cancelled_at))}{field(text.cancelledBy, submission.cancelled_by)}{field(text.cancellationReason, submission.cancellation_reason)}</dl></>}
                <p>{text.cancellationNoRefund}</p>
            </section>}
            <section className="course-section"><h2>{text.attendance}</h2>
                <p>{text.attendanceRequirement}: {course.attendance_requirement_percent}%</p>
                <table className="staff-table attendance-table"><caption className="visually-hidden">{text.attendance}</caption>
                    <thead><tr>{[text.session, text.attendanceStatus, text.checkIn, text.checkOut].map(function heading(label) { return <th scope="col" key={label}>{label}</th>; })}</tr></thead>
                    <tbody>{course.sessions.map(function sessionRow(session) {
                        const entry = registration.attendance[session.id];
                        return <tr key={session.id}><td data-label={text.session}>{courseText(session.topic, language)}</td><td data-label={text.attendanceStatus}>{!entry ? text.notRecorded : entry.attended ? text.attended : text.attendanceNotMet}</td><td data-label={text.checkIn}>{date(entry?.check_in_at)}</td><td data-label={text.checkOut}>{date(entry?.check_out_at)}</td></tr>;
                    })}</tbody>
                </table>
            </section>
            <section className="course-section"><h2>{text.certificate}</h2>
                {!registration.certificate_number ? <p>{text.notIssued}</p> : <dl className="staff-fields">{field(text.certificateNumber, registration.certificate_number)}{field(text.issuedAt, date(registration.certificate_issued_at))}</dl>}
            </section>
        </article>
    );
}

export default StaffRegistrationDetails;
