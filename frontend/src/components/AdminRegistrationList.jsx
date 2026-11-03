import { useEffect, useState } from 'react';
import { feeCents, formatCourseDate, formatMoney } from '../course-utils';
import AdminPagination from './AdminPagination';
import AdminRegistrationTable from './AdminRegistrationTable';

function AdminRegistrationList({ text, language, filters, onFilter, onSessionExpired, courseId }) {
    const [search, setSearch] = useState(filters.q);
    const [result, setResult] = useState({ status: 'loading', filters: null, courseId: null });
    const [refresh, setRefresh] = useState(0);
    const grouped = !courseId;
    const filtered = Boolean(filters.q || filters.state || filters.payment_state);
    useEffect(function loadRegistrations() {
        let ignore = false;
        async function load() {
            try {
                const query = new URLSearchParams();
                for (const [key, value] of Object.entries(filters)) if (value !== '') query.set(key, value);
                query.set('group_by', grouped ? 'submission' : 'registration');
                if (courseId) query.set('course_id', courseId);
                const response = await fetch(`/api/admin/registrations?${query}`, { signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (ignore) return;
                if (response.status === 401) return onSessionExpired();
                const records = grouped ? data.submissions : data.registrations;
                if (!response.ok || !Array.isArray(records)) throw new Error('Registration list unavailable.');
                setResult({ status: 'ready', filters, courseId, data: { ...data, records } });
            } catch {
                if (!ignore) setResult({ status: 'error', filters, courseId });
            }
        }
        load();
        return function ignoreOldResponse() { ignore = true; };
    }, [filters, courseId, grouped, refresh, onSessionExpired]);
    const loading = result.filters !== filters || result.courseId !== courseId || result.status === 'loading';
    return (
        <section className="admin-registration-list">
            {courseId && <h2>{text.registrations}</h2>}
            <form className="admin-filters" onSubmit={function searchRecords(event) { event.preventDefault(); onFilter({ ...filters, q: search, page: 1 }); }}>
                <label>{text.searchRegistrations}<input type="search" maxLength="100" value={search} onChange={function changeSearch(event) { setSearch(event.target.value); }} /></label>
                <label>{text.registrationState}<select value={filters.state} onChange={function changeState(event) { onFilter({ ...filters, state: event.target.value, page: 1 }); }}>
                    <option value="">{text.allStates}</option>{['registered', 'cancelled'].map(function option(state) { return <option value={state} key={state}>{text[`state_${state}`]}</option>; })}
                </select></label>
                <label>{text.paymentStatus}<select value={filters.payment_state} onChange={function changePayment(event) { onFilter({ ...filters, payment_state: event.target.value, page: 1 }); }}>
                    <option value="">{text.allPayments}</option>{['pending', 'paid', 'expired', 'cancelled', 'none'].map(function option(state) { return <option value={state} key={state}>{text[`payment_${state}`]}</option>; })}
                </select></label>
                <button type="submit">{text.search}</button>
                <button type="button" className="secondary-button" onClick={function clear() { setSearch(''); onFilter({ ...filters, q: '', state: '', payment_state: '', page: 1 }); }}>{text.clearFilters}</button>
            </form>
            <p>{grouped ? text.groupedRegistrationsExplanation : text.registrationFeeExplanation}</p>
            {loading ? <p role="status">{text.loadingRegistrations}</p> : result.status === 'error' ? (
                <div><p role="alert">{text.adminLoadError}</p><button type="button" onClick={function retry() { setResult({ status: 'loading', filters, courseId }); setRefresh(refresh + 1); }}>{text.tryAgain}</button></div>
            ) : <>
                {!result.data.records.length ? <p>{filtered ? text.noAdminMatches : text.noRegistrations}</p> : grouped ? (
                    <div className="submission-groups">{result.data.records.map(function submissionGroup(submission) {
                        return <section className="submission-group" key={submission.id} aria-labelledby={`submission-${submission.id}`}>
                            <header className="submission-group-header">
                                <div className="submission-participant"><h2 id={`submission-${submission.id}`}>{submission.reference}</h2>
                                    <p><strong>{submission.full_name}</strong></p><p>{submission.email}</p><p>{submission.phone}</p>
                                </div>
                                <dl className="submission-summary">
                                    <div><dt>{text.createdAt}</dt><dd>{formatCourseDate(submission.created_at, language, true)}</dd></div>
                                    <div><dt>{text.registrations}</dt><dd>{submission.registrations.length}</dd></div>
                                    {filtered && <div><dt>{text.matchingRegistrations}</dt><dd>{submission.registrations.filter(function matches(record) { return record.matches_filters; }).length}</dd></div>}
                                    <div><dt>{text.submissionTotal}</dt><dd>{formatMoney(feeCents(submission.total), language)}</dd></div>
                                    <div><dt>{text.paymentStatus}</dt><dd>{text[`payment_${submission.payment_state || 'none'}`]}</dd></div>
                                </dl>
                            </header>
                            <AdminRegistrationTable records={submission.registrations} text={text} language={language} grouped filtered={filtered}
                                caption={`${text.registrations} — ${submission.reference}`} />
                        </section>;
                    })}</div>
                ) : <AdminRegistrationTable records={result.data.records} text={text} language={language} />}
                <AdminPagination data={result.data} text={text} label={grouped ? text.submissions : text.records}
                    onPage={function changePage(page) { onFilter({ ...filters, page }); }} />
            </>}
        </section>
    );
}

export default AdminRegistrationList;
