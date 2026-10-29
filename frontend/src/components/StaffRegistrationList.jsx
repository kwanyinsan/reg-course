import { useEffect, useState } from 'react';
import { courseText, feeCents, formatCourseDate, formatMoney } from '../course-utils';
import StaffPagination from './StaffPagination';

function StaffRegistrationList({ text, language, filters, onFilter, onSessionExpired, courseId }) {
    const [search, setSearch] = useState(filters.q);
    const [result, setResult] = useState({ status: 'loading', filters: null, courseId: null });
    const [refresh, setRefresh] = useState(0);
    useEffect(function loadRegistrations() {
        let ignore = false;
        async function load() {
            try {
                const query = new URLSearchParams();
                for (const [key, value] of Object.entries(filters)) if (value !== '') query.set(key, value);
                if (courseId) query.set('course_id', courseId);
                const response = await fetch(`/api/staff/registrations?${query}`, { signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (ignore) return;
                if (response.status === 401) return onSessionExpired();
                if (!response.ok || !Array.isArray(data.registrations)) throw new Error('Registration list unavailable.');
                setResult({ status: 'ready', filters, courseId, data: { ...data, records: data.registrations } });
            } catch {
                if (!ignore) setResult({ status: 'error', filters, courseId });
            }
        }
        load();
        return function ignoreOldResponse() { ignore = true; };
    }, [filters, courseId, refresh, onSessionExpired]);
    const loading = result.filters !== filters || result.courseId !== courseId || result.status === 'loading';
    return (
        <section className="staff-registration-list">
            {courseId && <h2>{text.registrations}</h2>}
            <form className="staff-filters" onSubmit={function searchRecords(event) { event.preventDefault(); onFilter({ ...filters, q: search, page: 1 }); }}>
                <label>{text.searchRegistrations}<input type="search" maxLength="100" value={search} onChange={function changeSearch(event) { setSearch(event.target.value); }} /></label>
                <label>{text.registrationState}<select value={filters.state} onChange={function changeState(event) { onFilter({ ...filters, state: event.target.value, page: 1 }); }}>
                    <option value="">{text.allStates}</option>{['registered', 'cancelled'].map(function option(state) { return <option value={state} key={state}>{text[`state_${state}`]}</option>; })}
                </select></label>
                <label>{text.paymentStatus}<select value={filters.payment_state} onChange={function changePayment(event) { onFilter({ ...filters, payment_state: event.target.value, page: 1 }); }}>
                    <option value="">{text.allPayments}</option>{['pending', 'paid', 'expired', 'cancelled', 'none'].map(function option(state) { return <option value={state} key={state}>{text[`payment_${state}`]}</option>; })}
                </select></label>
                <button type="submit">{text.search}</button>
                <button type="button" className="secondary-button" onClick={function clear() { setSearch(''); onFilter({ q: '', state: '', payment_state: '', page: 1 }); }}>{text.clearFilters}</button>
            </form>
            <p>{text.registrationFeeExplanation}</p>
            {loading ? <p role="status">{text.loadingRegistrations}</p> : result.status === 'error' ? (
                <div><p role="alert">{text.staffLoadError}</p><button type="button" onClick={function retry() { setResult({ status: 'loading', filters, courseId }); setRefresh(refresh + 1); }}>{text.tryAgain}</button></div>
            ) : (
                <>
                    {!result.data.records.length ? <p>{filters.q || filters.state || filters.payment_state ? text.noStaffMatches : text.noRegistrations}</p> : (
                        <table className="staff-table staff-registration-table"><caption className="visually-hidden">{text.registrations}</caption>
                            <thead><tr>{[text.registration, text.participant, text.course, text.registeredAt, text.registrationState, text.paymentStatus, text.details].map(function heading(label) { return <th scope="col" key={label}>{label}</th>; })}</tr></thead>
                            <tbody>{result.data.records.map(function registrationRow(record) {
                                return <tr key={record.id}>
                                    <td data-label={text.registration}><strong>#{record.id}</strong><span>{record.submission_reference}</span></td>
                                    <td data-label={text.participant}><strong>{record.full_name}</strong><span>{record.email}</span><span>{record.phone}</span></td>
                                    <td data-label={text.course}><a href={`#staff/courses/${record.course_id}`}>{record.code}</a><span>{courseText(record.title, language)}</span><span>{text.registrationFee}: {formatMoney(feeCents(record.fee), language)}</span></td>
                                    <td data-label={text.registeredAt}>{formatCourseDate(record.created_at, language, true)}</td>
                                    <td data-label={text.registrationState}>{text[`state_${record.state}`]}</td>
                                    <td data-label={text.paymentStatus}>{text[`payment_${record.payment_state || 'none'}`]}</td>
                                    <td data-label={text.details}><a className="staff-row-link" href={`#staff/registrations/${record.id}`} aria-label={`${text.openRegistration} #${record.id}`}>{text.details}</a></td>
                                </tr>;
                            })}</tbody>
                        </table>
                    )}
                    <StaffPagination data={result.data} text={text} onPage={function changePage(page) { onFilter({ ...filters, page }); }} />
                </>
            )}
        </section>
    );
}

export default StaffRegistrationList;
