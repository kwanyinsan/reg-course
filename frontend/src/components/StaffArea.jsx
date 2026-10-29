import { useState } from 'react';
import StaffCourseList from './StaffCourseList';
import StaffCourseDetails from './StaffCourseDetails';
import StaffRegistrationList from './StaffRegistrationList';
import StaffRegistrationDetails from './StaffRegistrationDetails';

const emptyRegistrationFilters = { q: '', state: '', payment_state: '', page: 1 };

function StaffArea({ text, language, page, admin, busy, feedback, onLogout, onSessionExpired }) {
    const [courseFilters, setCourseFilters] = useState({ q: '', state: '', mode: '', page: 1 });
    const [registrationFilters, setRegistrationFilters] = useState(emptyRegistrationFilters);
    const [scopedFilters, setScopedFilters] = useState({ id: null, filters: emptyRegistrationFilters });
    const id = Number(page.split('/')[2]);
    return (
        <section className="staff-workspace" aria-busy={busy}>
            <div className="staff-account"><p>{text.signedInAs} <strong className="admin-name">{admin.username}</strong></p>
                <button type="button" disabled={busy} onClick={onLogout}>{busy ? text.loggingOut : text.logOut}</button>
            </div>
            {feedback && <p className="feedback error" role="alert">{text[feedback]}</p>}
            {busy && <p className="visually-hidden" role="status">{text.loggingOut}</p>}
            {page.startsWith('staff/registrations/') ? <StaffRegistrationDetails id={id} text={text} language={language} onSessionExpired={onSessionExpired} />
                : page === 'staff/registrations' ? <StaffRegistrationList text={text} language={language} filters={registrationFilters} onFilter={setRegistrationFilters} onSessionExpired={onSessionExpired} />
                    : page.startsWith('staff/courses/') ? <StaffCourseDetails id={id} text={text} language={language}
                        filters={scopedFilters.id === id ? scopedFilters.filters : emptyRegistrationFilters}
                        onFilter={function changeScopedFilters(filters) { setScopedFilters({ id, filters }); }} onSessionExpired={onSessionExpired} />
                        : <StaffCourseList text={text} language={language} filters={courseFilters} onFilter={setCourseFilters} onSessionExpired={onSessionExpired} />}
        </section>
    );
}

export default StaffArea;
