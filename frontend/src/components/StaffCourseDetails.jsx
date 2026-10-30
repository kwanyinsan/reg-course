import { useEffect, useState } from 'react';
import { courseText } from '../course-utils';
import CourseInformation from './CourseInformation';
import StaffRegistrationList from './StaffRegistrationList';

function StaffCourseDetails({ id, text, language, filters, onFilter, onSessionExpired }) {
    const [result, setResult] = useState({ id: null, status: 'loading' });
    const [refresh, setRefresh] = useState(0);
    useEffect(function loadCourse() {
        let ignore = false;
        async function load() {
            try {
                const response = await fetch(`/api/staff/courses/${id}`, { signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (ignore) return;
                if (response.status === 401) return onSessionExpired();
                if (!response.ok || !data.course) return setResult({ id, status: 'error', message: response.status === 404 ? 'courseUnavailable' : 'staffLoadError' });
                setResult({ id, status: 'ready', course: data.course });
            } catch {
                if (!ignore) setResult({ id, status: 'error', message: 'staffLoadError' });
            }
        }
        load();
        return function ignoreOldResponse() { ignore = true; };
    }, [id, refresh, onSessionExpired]);
    if (result.id !== id || result.status === 'loading') return <p role="status">{text.loadingCourses}</p>;
    if (result.status === 'error') return <section><p role="alert">{text[result.message]}</p><button type="button" onClick={function retry() { setResult({ id, status: 'loading' }); setRefresh(refresh + 1); }}>{text.tryAgain}</button><p><a href="#staff/courses">{text.backToStaffCourses}</a></p></section>;
    const course = result.course;
    return (
        <section>
            <a href="#staff/courses">{text.backToStaffCourses}</a>
            <h2>{courseText(course.title, language)}</h2>
            <p className="course-code">{course.code} — {text[`state_${course.state}`]}</p>
            <div className="course-actions"><a className="button secondary-button" href={`#staff/courses/${course.id}/questions`}>{course.questions_editable ? text.editQuestionBank : text.viewQuestionBank}</a>
                <span>{course.questions_editable ? text.questionsEditable : text.questionsLocked}</span></div>
            <p>{courseText(course.short_description, language)}</p>
            <p>{text.state_registered}: {course.registered_count}; {text.state_cancelled}: {course.cancelled_count}; {text.records}: {course.total_registrations}</p>
            <CourseInformation course={course} text={text} language={language} />
            <StaffRegistrationList key={id} courseId={id} text={text} language={language} filters={filters} onFilter={onFilter} onSessionExpired={onSessionExpired} />
        </section>
    );
}

export default StaffCourseDetails;
