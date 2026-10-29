import { useEffect, useState } from 'react';
import { courseText } from '../course-utils';
import CourseInformation from './CourseInformation';

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
            <CourseInformation course={course} text={text} language={language} />
        </article>
    );
}

export default CourseDetails;
