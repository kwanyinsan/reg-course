import { courseText, feeCents, formatCourseDate, formatMoney } from '../course-utils';

function AdminRegistrationTable({ records, text, language, grouped = false, caption = text.registrations, filtered = false }) {
    const headings = [text.registration, ...(!grouped ? [text.participant] : []), text.course,
        text.registeredAt, text.registrationState, ...(!grouped ? [text.paymentStatus] : []), text.details];
    return <table className={`admin-table ${grouped ? 'admin-group-table' : 'admin-registration-table'}`}>
        <caption className="visually-hidden">{caption}</caption>
        <thead><tr>{headings.map(function heading(label) { return <th scope="col" key={label}>{label}</th>; })}</tr></thead>
        <tbody>{records.map(function registrationRow(record) {
            return <tr key={record.id}>
                <td data-label={text.registration}><strong>#{record.id}</strong>{!grouped && <span>{record.submission_reference}</span>}</td>
                {!grouped && <td data-label={text.participant}><strong>{record.full_name}</strong><span>{record.email}</span><span>{record.phone}</span></td>}
                <td data-label={text.course}><a href={`#admin/courses/${record.course_id}`}>{record.code} — {courseText(record.title, language)}</a>
                    <span>{text.registrationFee}: {formatMoney(feeCents(record.fee), language)}</span>
                    {filtered && record.matches_filters === false && <span className="registration-context">{text.otherCourseInSubmission}</span>}
                </td>
                <td data-label={text.registeredAt}>{formatCourseDate(record.created_at, language, true)}</td>
                <td data-label={text.registrationState}>{text[`state_${record.state}`]}</td>
                {!grouped && <td data-label={text.paymentStatus}>{text[`payment_${record.payment_unavailable_reason ? 'unavailable' : record.payment_state || (Number(record.submission_total) === 0 ? 'not_required' : 'none')}`]}</td>}
                <td data-label={text.details}><a className="admin-row-link" href={`#admin/registrations/${record.id}`} aria-label={`${text.openRegistration} #${record.id}`}>{text.details}</a></td>
            </tr>;
        })}</tbody>
    </table>;
}

export default AdminRegistrationTable;
