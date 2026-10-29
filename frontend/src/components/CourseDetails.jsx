import { useEffect, useState } from 'react';
import { courseText, feeCents, formatCourseDate, formatMoney } from '../course-utils';

function CourseDetails({ id, text, language, selected, busy, onToggle, onLoaded, showTitle, refresh }) {
    const [result, setResult] = useState({ id: null, status: 'loading' });
    const [retry, setRetry] = useState(0);

    useEffect(function loadDetail() {
        let ignore = false;
        async function requestCourse() {
            try {
                const response = await fetch(`/api/courses/${id}`, { signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (ignore) return;
                if (response.ok && data.course) {
                    setResult({ id, status: 'ready', course: data.course });
                    onLoaded(data.course);
                } else {
                    setResult({ id, status: 'error', message: response.status === 404 ? 'courseUnavailable' : 'courseLoadError' });
                }
            } catch {
                if (!ignore) setResult({ id, status: 'error', message: 'courseLoadError' });
            }
        }
        requestCourse();
        return function ignoreOldResponse() { ignore = true; };
    }, [id, retry, refresh, onLoaded]);

    if (result.id !== id || result.status === 'loading') return <p role="status">{text.loadingCourses}</p>;
    if (result.status === 'error') {
        return (
            <section className="course-error">
                <p role="alert">{text[result.message]}</p>
                <div className="course-actions">
                    <button type="button" onClick={function retryDetails() {
                        setResult({ id, status: 'loading' });
                        setRetry(function increment(previous) { return previous + 1; });
                    }}>{text.tryAgain}</button>
                    <a href="#courses">{text.backToCourses}</a>
                </div>
            </section>
        );
    }

    const course = result.course;
    const information = course.information;
    const fields = ['venue', 'audience', 'prerequisites', 'teaching_language'];
    return (
        <article className="course-detail">
            {showTitle && <h2>{courseText(course.title, language)}</h2>}
            <p className="course-code">{course.code}</p>
            <p>{courseText(course.short_description, language)}</p>
            <div className="course-actions">
                <a href="#courses">{text.backToCourses}</a>
                <button type="button" aria-pressed={selected}
                    disabled={busy || (!selected && course.availability !== 'open')}
                    onClick={function toggle() { onToggle(course); }}>
                    {selected ? text.remove : text.selectCourse}
                </button>
                <span className={`course-availability ${course.availability}`}>{text[course.availability]}</span>
            </div>
            <section className="course-section">
                <h2>{text.overview}</h2>
                <dl className="course-facts course-overview">
                    <div><dt>{text.fee}</dt><dd>{formatMoney(feeCents(course.fee), language)}</dd></div>
                    <div><dt>{text.courseMode}</dt><dd>{text[course.mode]}</dd></div>
                    <div><dt>{text.registrationOpens}</dt><dd>{course.registration_opens_at ? formatCourseDate(course.registration_opens_at, language, true) : text.noOpeningDate}</dd></div>
                    <div><dt>{text.registrationCloses}</dt><dd>{course.registration_closes_at ? formatCourseDate(course.registration_closes_at, language, true) : text.noClosingDate}</dd></div>
                    <div><dt>{text.paymentDeadline}</dt><dd>{formatCourseDate(course.payment_deadline, language, true)}</dd></div>
                    <div><dt>{text.attendanceRequirement}</dt><dd>{course.attendance_requirement_percent}%</dd></div>
                </dl>
            </section>
            <section className="course-section">
                <h2>{text.description}</h2>
                <p className="course-description">{courseText(course.long_description, language)}</p>
            </section>
            {fields.map(function optionalSection(key) {
                const value = courseText(information[key], language);
                return value ? <section className="course-section" key={key}><h2>{text[key]}</h2><p>{value}</p></section> : null;
            })}
            {information.learning_outcomes?.length > 0 && (
                <section className="course-section"><h2>{text.learning_outcomes}</h2>
                    <ul>{information.learning_outcomes.map(function outcome(value, index) {
                        return <li key={index}>{courseText(value, language)}</li>;
                    })}</ul>
                </section>
            )}
            <section className="course-section">
                <h2>{text.sessions}</h2>
                <p>{text.hongKongTime}</p>
                {course.sessions.map(function sessionDetails(session) {
                    const description = courseText(session.description, language);
                    const speaker = courseText(session.speaker, language);
                    return (
                        <section className="course-session" key={session.id}>
                            <h3>{courseText(session.topic, language)}</h3>
                            <p>{formatCourseDate(session.starts_at, language, true)} – {formatCourseDate(session.ends_at, language, true)}</p>
                            <p>{text.courseMode}: {text[session.mode]}</p>
                            {description && <p className="course-description">{description}</p>}
                            {speaker && <p>{text.speaker}: {speaker}</p>}
                        </section>
                    );
                })}
            </section>
        </article>
    );
}

export default CourseDetails;
