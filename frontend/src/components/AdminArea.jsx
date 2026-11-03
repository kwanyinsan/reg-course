import { useState } from 'react';
import AdminCourseList from './AdminCourseList';
import AdminCourseDetails from './AdminCourseDetails';
import AdminRegistrationList from './AdminRegistrationList';
import AdminRegistrationDetails from './AdminRegistrationDetails';
import CourseQuestionEditor from './CourseQuestionEditor';

const emptyRegistrationFilters = { q: '', state: '', payment_state: '', page: 1 };

function AdminArea({ text, language, page, admin, busy, onNotice, onLogout, onSessionExpired, questionDraft, onQuestionDraftChange }) {
    const [courseFilters, setCourseFilters] = useState({ q: '', state: '', mode: '', page: 1 });
    const [registrationFilters, setRegistrationFilters] = useState(emptyRegistrationFilters);
    const [scopedFilters, setScopedFilters] = useState({ id: null, filters: emptyRegistrationFilters });
    const id = Number(page.split('/')[2]);
    return (
        <section className="admin-workspace" aria-busy={busy}>
            <div className="admin-account"><p>{text.signedInAs} <strong className="admin-name">{admin.username}</strong></p>
                <button type="button" disabled={busy} onClick={onLogout}>{busy ? text.loggingOut : text.logOut}</button>
            </div>
            {busy && <p className="visually-hidden" role="status">{text.loggingOut}</p>}
            {page.endsWith('/questions') ? <CourseQuestionEditor id={id} adminId={admin.id} text={text} language={language} draft={questionDraft} onDraftChange={onQuestionDraftChange} onSessionExpired={onSessionExpired} onNotice={onNotice} />
                : page.startsWith('admin/registrations/') ? <AdminRegistrationDetails id={id} text={text} language={language} onSessionExpired={onSessionExpired} />
                : page === 'admin/registrations' ? <AdminRegistrationList text={text} language={language} filters={registrationFilters} onFilter={setRegistrationFilters} onSessionExpired={onSessionExpired} />
                    : page.startsWith('admin/courses/') ? <AdminCourseDetails id={id} text={text} language={language}
                        filters={scopedFilters.id === id ? scopedFilters.filters : emptyRegistrationFilters}
                        onFilter={function changeScopedFilters(filters) { setScopedFilters({ id, filters }); }} onSessionExpired={onSessionExpired} />
                        : <AdminCourseList text={text} language={language} filters={courseFilters} onFilter={setCourseFilters} onSessionExpired={onSessionExpired} />}
        </section>
    );
}

export default AdminArea;
