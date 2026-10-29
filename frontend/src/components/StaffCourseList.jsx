import { useEffect, useState } from 'react';
import { courseText, feeCents, formatCourseDate, formatMoney } from '../course-utils';
import StaffPagination from './StaffPagination';

function StaffCourseList({ text, language, filters, onFilter, onSessionExpired }) {
    const [search, setSearch] = useState(filters.q);
    const [result, setResult] = useState({ status: 'loading', filters: null });
    const [refresh, setRefresh] = useState(0);
    useEffect(function loadCourses() {
        let ignore = false;
        async function load() {
            try {
                const query = new URLSearchParams();
                for (const [key, value] of Object.entries(filters)) if (value !== '') query.set(key, value);
                const response = await fetch(`/api/staff/courses?${query}`, { signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (ignore) return;
                if (response.status === 401) return onSessionExpired();
                if (!response.ok || !Array.isArray(data.courses)) throw new Error('Course list unavailable.');
                setResult({ status: 'ready', filters, data: { ...data, records: data.courses } });
            } catch {
                if (!ignore) setResult({ status: 'error', filters });
            }
        }
        load();
        return function ignoreOldResponse() { ignore = true; };
    }, [filters, refresh, onSessionExpired]);
    const loading = result.filters !== filters || result.status === 'loading';
    return (
        <section>
            <form className="staff-filters" onSubmit={function searchCourses(event) { event.preventDefault(); onFilter({ ...filters, q: search, page: 1 }); }}>
                <label>{text.searchCourses}<input type="search" maxLength="100" value={search} onChange={function changeSearch(event) { setSearch(event.target.value); }} /></label>
                <label>{text.courseState}<select value={filters.state} onChange={function changeState(event) { onFilter({ ...filters, state: event.target.value, page: 1 }); }}>
                    <option value="">{text.allStates}</option>{['draft', 'published', 'archived'].map(function stateOption(state) { return <option key={state} value={state}>{text[`state_${state}`]}</option>; })}
                </select></label>
                <label>{text.courseMode}<select value={filters.mode} onChange={function changeMode(event) { onFilter({ ...filters, mode: event.target.value, page: 1 }); }}>
                    <option value="">{text.allModes}</option>{['in_person', 'virtual', 'hybrid'].map(function modeOption(mode) { return <option key={mode} value={mode}>{text[mode]}</option>; })}
                </select></label>
                <button type="submit">{text.search}</button>
                <button type="button" className="secondary-button" onClick={function clear() { setSearch(''); onFilter({ q: '', state: '', mode: '', page: 1 }); }}>{text.clearFilters}</button>
            </form>
            <p>{text.countExplanation}</p>
            {loading ? <p role="status">{text.loadingCourses}</p> : result.status === 'error' ? (
                <div><p role="alert">{text.staffLoadError}</p><button type="button" onClick={function retry() { setResult({ status: 'loading', filters }); setRefresh(refresh + 1); }}>{text.tryAgain}</button></div>
            ) : (
                <>
                    {!result.data.records.length ? <p>{filters.q || filters.state || filters.mode ? text.noStaffMatches : text.noStaffCourses}</p> : (
                        <table className="staff-table staff-course-table"><caption className="visually-hidden">{text.staffCourses}</caption>
                            <thead><tr>{[text.course, text.courseDates, text.courseMode, text.fee, text.courseState, text.registrationCounts, text.details].map(function heading(label) { return <th scope="col" key={label}>{label}</th>; })}</tr></thead>
                            <tbody>{result.data.records.map(function courseRow(course) {
                                return <tr key={course.id}>
                                    <td data-label={text.course}><strong>{course.code}</strong><span>{courseText(course.title, language)}</span></td>
                                    <td data-label={text.courseDates}>{formatCourseDate(course.starts_at, language)} – {formatCourseDate(course.ends_at, language)}</td>
                                    <td data-label={text.courseMode}>{text[course.mode]}</td>
                                    <td data-label={text.fee}>{formatMoney(feeCents(course.fee), language)}</td>
                                    <td data-label={text.courseState}>{text[`state_${course.state}`]}</td>
                                    <td data-label={text.registrationCounts}>{course.registered_count} / {course.total_registrations}</td>
                                    <td data-label={text.details}><a className="staff-row-link" href={`#staff/courses/${course.id}`} aria-label={`${text.openCourse}: ${courseText(course.title, language)}`}>{text.openCourse}</a></td>
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

export default StaffCourseList;
