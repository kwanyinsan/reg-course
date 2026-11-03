import { useCallback, useEffect, useRef, useState } from 'react';
import { attendanceRequest } from '../attendance-api';
import { formatCourseDate } from '../course-utils';
import AttendanceCorrection from './AttendanceCorrection';
import SessionAttendanceResults from './SessionAttendanceResults';

export default function SessionAttendance({ courseId, sessionId, text, language, onSessionExpired, onNotice }) {
    const path = `admin/courses/${courseId}/attendance/${sessionId}`;
    const [data, setData] = useState(null);
    const [issue, setIssue] = useState('');
    const [busy, setBusy] = useState(false);
    const [resultBusy, setResultBusy] = useState(false);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    const [editing, setEditing] = useState(null);
    const [now, setNow] = useState(Date.now);
    const mounted = useRef(true);
    const sending = useRef(false);
    const load = useCallback(async function loadAttendance() {
        try {
            const result = await attendanceRequest(path);
            if (mounted.current) { setData({ ...result, offset: new Date(result.server_time).getTime() - Date.now() }); setIssue(''); }
            return result;
        } catch (error) {
            if (mounted.current) { if (error.status === 401) onSessionExpired(); setIssue(error.code || 'attendance_unavailable'); }
            return null;
        }
    }, [path, onSessionExpired]);
    useEffect(function initialise() {
        mounted.current = true;
        async function initialiseLoad() { await load(); }
        initialiseLoad();
        return () => { mounted.current = false; };
    }, [load]);
    useEffect(function clock() { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);

    async function send(result, retry = false) {
        if (sending.current) return;
        sending.current = true;
        setBusy(true);
        try {
            const targets = result.participants.filter(row => row.email_eligible && (retry ? row.email_status === 'failed' : ['not_requested', 'requested'].includes(row.email_status)));
            for (const row of targets) {
                if (!mounted.current) break;
                try {
                    const outcome = await attendanceRequest(`${path}/email`, 'POST', { registration_id: row.id, retry });
                    if (mounted.current) setData(previous => ({ ...previous, participants: previous.participants.map(item => item.id === row.id ? { ...item, email_status: outcome.status } : item) }));
                } catch (error) {
                    if (mounted.current) { if (error.status === 401) onSessionExpired(); setIssue(error.code || 'attendance_unavailable'); }
                    break;
                }
            }
        } finally { sending.current = false; if (mounted.current) { setBusy(false); await load(); } }
    }
    async function open() {
        setBusy(true);
        try {
            const opened = await attendanceRequest(`${path}/start`, 'POST', {});
            const result = await load();
            if (!opened.repeated && result && mounted.current) await send(result);
        } catch (error) {
            if (mounted.current) { if (error.status === 401) onSessionExpired(); setIssue(error.code || 'attendance_unavailable'); }
        } finally { if (mounted.current) setBusy(false); }
    }
    const active = data?.round && now + data.offset < new Date(data.round.closes_at).getTime();
    const rows = (data?.participants || []).filter(row => (!status || (status === 'present' ? Boolean(row.entry) : !row.entry)) &&
        `${row.full_name} ${row.reference} ${row.email}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    const pages = Math.max(1, Math.ceil(rows.length / 25));
    const currentPage = Math.min(page, pages);
    const counts = {};
    for (const row of data?.participants || []) counts[row.email_status] = (counts[row.email_status] || 0) + 1;
    const working = busy || resultBusy;
    return <div className="session-attendance" aria-busy={working}>
        <div className="attendance-actions"><button type="button" disabled={working || !data?.can_start} onClick={open}>{text.attTaking}</button>
            <a href={`#admin/courses/${courseId}/attendance/${sessionId}/qr`}>{text.attShowQr}</a>
            <SessionAttendanceResults data={data} path={path} text={text} language={language} busy={working} onBusyChange={setResultBusy} load={load} onSessionExpired={onSessionExpired} onNotice={onNotice} /></div>
        {issue && <p className="feedback error" role="alert">{text[issue] || text.attendance_unavailable}</p>}
        {!data ? <p role="status">{text.attLoading}</p> : <>
            <p>{data.round ? active ? text.attOpen : text.attClosed : text.attNotOpen}{data.round && <> — {text.attCloses}: {formatCourseDate(data.round.closes_at, language, true)}</>}</p>
            {!data.round && <p className="attendance-note">{text.attWindow}</p>}
            {busy && <p role="status">{text.attSending}</p>}
            {data.round && <><p>{text.resultScannerEmails}: {Object.entries(counts).map(([key, count]) => `${text[`attEmail_${key}`]}: ${count}`).join(' · ')}</p>
                <p className="attendance-note">{text.attEmailNote}</p>
                <div className="attendance-actions">
                    <button type="button" className="secondary-button" disabled={working || !active || !data.participants.some(row => row.email_eligible && ['not_requested', 'requested'].includes(row.email_status))} onClick={() => send(data)}>{text.attSendRemaining}</button>
                    <button type="button" className="secondary-button" disabled={working || !active || !counts.failed} onClick={() => send(data, true)}>{text.attRetryFailed}</button>
                </div></>}
            <details className="attendance-roster"><summary>{text.attRecords}: {data.participants.filter(row => row.entry).length} / {data.participants.length}</summary>
                <p>{text.attRefreshNote}: {formatCourseDate(data.server_time, language, true)}</p>
                <div className="attendance-filters"><label>{text.attSearch}<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
                    <label>{text.attFilter}<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">{text.attAll}</option><option value="present">{text.attPresent}</option><option value="missing">{text.attMissing}</option></select></label></div>
                <ul className="attendance-participants">{rows.slice((currentPage - 1) * 25, currentPage * 25).map(row => <li key={row.id}>
                    <h4><a href={`#admin/registrations/${row.id}`}>{row.full_name}</a></h4><p>{row.reference} — {row.email}</p>
                    <dl className="admin-fields"><div><dt>{text.attFilter}</dt><dd>{row.entry ? text.attPresent : text.attMissing}{row.cancelled && ` — ${text.state_cancelled}`}</dd></div>
                        <div><dt>{text.attTime}</dt><dd>{row.entry ? formatCourseDate(row.entry.recorded_at, language, true) : '—'}</dd></div>
                        <div><dt>{text.attPercent}</dt><dd>{row.percentage.completed}/{row.percentage.total} ({Number(row.percentage.percent.toFixed(2))}%){row.percentage.provisional && <> — {text.attProvisional}</>}</dd></div>
                        <div><dt>{text.paymentStatus}</dt><dd>{text[`payment_${row.payment_state}`] || text.attPaymentNone}</dd></div>
                        <div><dt>{text.resultScannerEmails}</dt><dd>{text[`attEmail_${row.email_status}`]}</dd></div>
                        <div><dt>{text.resultStatus}</dt><dd>{text[`attEmail_${row.result_mail.status}`]}
                            {row.result_mail.changed && <p>{text.resultChangedNote}</p>}{row.result_mail.reason && <p>{text[row.result_mail.reason]}</p>}</dd></div></dl>
                    {row.certificate_locked ? <p>{text.attendance_certificate_locked}</p> : <button type="button" className="secondary-button" disabled={working} onClick={() => setEditing(row)}>{text.attCorrect}</button>}
                    {editing?.id === row.id && <AttendanceCorrection key={row.id} row={editing} sessionId={sessionId} text={text} onSessionExpired={onSessionExpired}
                        onCancel={() => setEditing(null)} onSaved={function saved() { setEditing(null); onNotice('attSaved'); load(); }} />}
                </li>)}</ul>
                {!rows.length && <p>{text.attNoRecords}</p>}
                <div className="attendance-actions"><button type="button" className="secondary-button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>{text.attPrevious}</button><span>{text.attPage} {currentPage}/{pages}</span><button type="button" className="secondary-button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>{text.attNext}</button></div>
            </details>
        </>}
        <button type="button" className="secondary-button attendance-refresh" disabled={working} onClick={load}>{text.attRefresh}</button>
    </div>;
}
