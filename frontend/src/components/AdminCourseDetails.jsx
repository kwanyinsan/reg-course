import { useEffect, useState } from 'react';
import { courseText } from '../course-utils';
import CourseInformation from './CourseInformation';
import AdminRegistrationList from './AdminRegistrationList';
import SessionAttendance from './SessionAttendance';
import CourseCertificateSend from './CourseCertificateSend';

function AdminCourseDetails({ id, text, language, filters, onFilter, onSessionExpired, onNotice }) {
    const [result, setResult] = useState({ id: null, status: 'loading' });
    const [refresh, setRefresh] = useState(0);
    const [stateAction, setStateAction] = useState(null);
    const [savingState, setSavingState] = useState(false);
    async function changeState() {
        if (savingState || !stateAction || result.id !== id) return;
        setSavingState(true);
        try {
            const response = await fetch(`/api/admin/courses/${id}/state`, {
                method: 'POST', signal: AbortSignal.timeout(10000),
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'reg-course' },
                body: JSON.stringify({ state: stateAction, original_state: result.course.state }),
            });
            const data = await response.json();
            if (response.status === 401) return onSessionExpired();
            if (!response.ok) {
                onNotice(text[data.code] ? data.code : 'courseStateError', 'error');
                return;
            }
            setResult(current => current.id !== id ? current : { ...current, course: { ...current.course, ...data.course,
                questions_editable: false, certificate_editable: false } });
            setStateAction(null);
            setRefresh(current => current + 1);
            onNotice(data.course.state === 'published' ? 'coursePublished' : 'courseArchived');
        } catch {
            onNotice('courseStateUnknown', 'error');
        } finally {
            setSavingState(false);
        }
    }
    useEffect(function loadCourse() {
        let ignore = false;
        async function load() {
            try {
                const response = await fetch(`/api/admin/courses/${id}`, { signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (ignore) return;
                if (response.status === 401) return onSessionExpired();
                if (!response.ok || !data.course) return setResult({ id, status: 'error', message: response.status === 404 ? 'courseUnavailable' : 'adminLoadError' });
                setResult({ id, status: 'ready', course: data.course });
            } catch {
                if (!ignore) setResult({ id, status: 'error', message: 'adminLoadError' });
            }
        }
        load();
        return function ignoreOldResponse() { ignore = true; };
    }, [id, refresh, onSessionExpired]);
    if (result.id !== id || result.status === 'loading') return <p role="status">{text.loadingCourses}</p>;
    if (result.status === 'error') return <section><p role="alert">{text[result.message]}</p><button type="button" onClick={function retry() { setResult({ id, status: 'loading' }); setRefresh(refresh + 1); }}>{text.tryAgain}</button></section>;
    const course = result.course;
    return (
        <section>
            <h2>{courseText(course.title, language)}</h2>
            <p className="course-code">{course.code} — {text[`state_${course.state}`]}</p>
            <div className="course-actions"><a className="button secondary-button" href={`#admin/courses/${course.id}/questions`}>{course.questions_editable ? text.editQuestionBank : text.viewQuestionBank}</a>
                <span>{course.questions_editable ? text.questionsEditable : text.questionsLocked}</span></div>
            <div className="course-actions"><a className="button secondary-button" href={`#admin/courses/${course.id}/certificate`}>{course.certificate_editable ? text.editCertificate : text.viewCertificate}</a>
                <span>{course.certificate_editable ? text.certificateEditable : text.certificateLocked}</span></div>
            <p>{courseText(course.short_description, language)}</p>
            <p>{text.state_registered}: {course.registered_count}; {text.state_cancelled}: {course.cancelled_count}; {text.records}: {course.total_registrations}</p>
            <CourseCertificateSend key={course.state} courseId={course.id} text={text} onSessionExpired={onSessionExpired} onNotice={onNotice} />
            <CourseInformation course={course} text={text} language={language} sessionActions={session => <SessionAttendance key={course.state} courseId={course.id} sessionId={session.id} text={text} language={language} onSessionExpired={onSessionExpired} onNotice={onNotice} />} />
            <AdminRegistrationList key={id} courseId={id} text={text} language={language} filters={filters} onFilter={onFilter} onSessionExpired={onSessionExpired} />
            <div className="course-state-actions" aria-busy={savingState}>
                <div className="course-actions">
                    <button type="button" disabled={savingState || course.state === 'published'} onClick={() => setStateAction('published')}>{text.publishCourse}</button>
                    <button type="button" className="secondary-button" disabled={savingState || course.state === 'archived'} onClick={() => setStateAction('archived')}>{text.archiveCourse}</button>
                </div>
                {stateAction && <section className="course-state-confirmation" aria-label={stateAction === 'published' ? text.publishCourse : text.archiveCourse}>
                    <p>{stateAction === 'published' ? text.publishCourseWarning : text.archiveCourseWarning}</p>
                    <div className="course-actions">
                        <button type="button" disabled={savingState} onClick={changeState}>{savingState ? text.courseStateSaving : stateAction === 'published' ? text.confirmPublish : text.confirmArchive}</button>
                        <button type="button" className="secondary-button" disabled={savingState} onClick={() => setStateAction(null)}>{text.courseStateCancel}</button>
                    </div>
                </section>}
            </div>
        </section>
    );
}

export default AdminCourseDetails;
