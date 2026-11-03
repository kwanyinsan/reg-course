import { useEffect, useState } from 'react';
import { formatCourseDate } from '../course-utils';

function actionLabel(row, text) {
    const mail = row.action.match(/^(acknowledgement|attendance_email|certificate_email|attendance_result_email)_(requested|started|accepted|failed|uncertain)$/);
    return mail ? `${text[`act_mail_${mail[1]}`]} — ${text[`act_out_${mail[2]}`]}` : text[`act_${row.action}`] || text.act_other;
}

export default function AdminActivity({ text, language, filters, onFilter, onSessionExpired }) {
    const [draft, setDraft] = useState(filters);
    const [result, setResult] = useState(null);
    const [issue, setIssue] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [pages, setPages] = useState(['']);
    const [page, setPage] = useState(0);
    const cursor = pages[page];
    useEffect(function loadActivity() {
        let ignore = false;
        async function load() {
            try {
                const query = new URLSearchParams();
                for (const [key, value] of Object.entries({ ...filters, cursor })) if (value) query.set(key, value);
                const response = await fetch(`/api/admin/activity?${query}`, { signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (ignore) return;
                if (response.status === 401) return onSessionExpired();
                if (!response.ok) { setIssue(data.code || 'activity_unavailable'); return; }
                setResult({ filters, cursor, refresh, data }); setIssue('');
            } catch { if (!ignore) setIssue('activity_unavailable'); }
        }
        load();
        return () => { ignore = true; };
    }, [filters, cursor, refresh, onSessionExpired]);
    function reset() { setPages(['']); setPage(0); setIssue(''); }
    const loading = !issue && (!result || result.filters !== filters || result.cursor !== cursor || result.refresh !== refresh);
    return <section>
        <p>{text.actNote}</p>
        <form className="admin-filters activity-filters" onSubmit={event => { event.preventDefault(); reset(); onFilter({ ...draft }); }}>
            <label>{text.actGroup}<select value={draft.group} onChange={event => setDraft({ ...draft, group: event.target.value })}><option value="">{text.actAll}</option>{['access', 'applications', 'courses', 'payments', 'attendance', 'email', 'certificates', 'system', 'other'].map(group => <option key={group} value={group}>{text[`act_group_${group}`]}</option>)}</select></label>
            <label>{text.actActor}<select value={draft.actor} onChange={event => setDraft({ ...draft, actor: event.target.value })}><option value="">{text.actAll}</option>{['admin', 'participant', 'system'].map(actor => <option key={actor} value={actor}>{text[`act_actor_${actor}`]}</option>)}</select></label>
            <label>{text.actFrom}<input type="date" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
            <label>{text.actTo}<input type="date" value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} /></label>
            <label>{text.actSearch}<input type="search" maxLength="100" value={draft.q} onChange={event => setDraft({ ...draft, q: event.target.value })} /></label>
            <button type="submit">{text.search}</button><button type="button" className="secondary-button" onClick={() => { const empty = { group: '', actor: '', from: '', to: '', q: '' }; setDraft(empty); reset(); onFilter(empty); }}>{text.clearFilters}</button>
        </form>
        <button type="button" className="secondary-button" onClick={() => { reset(); setRefresh(refresh + 1); }}>{text.actRefresh}</button>
        {issue ? <p className="feedback error" role="alert">{text[issue] || text.activity_unavailable}</p> : loading ? <p role="status">{text.actLoading}</p> : <>
            {!result.data.records.length ? <p>{text.actEmpty}</p> : <table className="admin-table activity-table"><caption className="visually-hidden">{text.activity}</caption>
                <thead><tr>{[text.actTime, text.actAction, text.actActor, text.actRelated, text.actOutcome].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
                <tbody>{result.data.records.map(row => <tr key={row.id}>
                    <td data-label={text.actTime}>{formatCourseDate(row.created_at, language, true)}</td>
                    <td data-label={text.actAction}><strong>{actionLabel(row, text)}</strong>
                        {row.summary.session_id && <p>{text.actSession}: {row.summary.session_id}</p>}
                        {['recorded_at', 'before_at', 'after_at', 'closes_at'].map(key => row.summary[key] && <p key={key}>{text[{ recorded_at: 'attTime', before_at: 'actBefore', after_at: 'actAfter', closes_at: 'attCloses' }[key]]}: {formatCourseDate(row.summary[key], language, true)}</p>)}
                        {row.summary.question_count !== undefined && <p>{text.actQuestions}: {row.summary.question_count}</p>}
                        {row.summary.registration_count !== undefined && <p>{text.actRegistrations}: {row.summary.registration_count}</p>}
                        {row.summary.certificate_number && <p>{row.summary.certificate_number}</p>}</td>
                    <td data-label={text.actActor}>{text[`act_actor_${row.actor.type}`]}{row.actor.username && <p>{row.actor.username}</p>}</td>
                    <td data-label={text.actRelated}><ul className="activity-related">
                        {row.related.course_id && <li><a href={`#admin/courses/${row.related.course_id}`}>{row.related.course_code}</a></li>}
                        {row.related.application_reference && <li>{row.related.application_reference}</li>}
                        {row.related.registration_id && <li><a href={`#admin/registrations/${row.related.registration_id}`}>{text.registrationDetails} #{row.related.registration_id}</a></li>}
                        {row.related.payment_reference && <li>{row.related.payment_reference}</li>}</ul></td>
                    <td data-label={text.actOutcome}>{text[`act_out_${row.outcome}`] || text.act_out_recorded}</td>
                </tr>)}</tbody>
            </table>}
            <p className="attendance-note">{text.actMailNote}</p>
            <nav className="attendance-actions" aria-label={text.actPages}>
                <button type="button" className="secondary-button" disabled={!page} onClick={() => setPage(page - 1)}>{text.attPrevious}</button>
                <span>{text.actPage} {page + 1} · {text.actCount}: {result.data.records.length}</span>
                <button type="button" className="secondary-button" disabled={!result.data.next_cursor} onClick={() => { setPages([...pages.slice(0, page + 1), result.data.next_cursor]); setPage(page + 1); }}>{text.attNext}</button>
            </nav>
        </>}
    </section>;
}
