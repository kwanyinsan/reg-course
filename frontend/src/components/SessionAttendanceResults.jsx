import { useEffect, useRef, useState } from 'react';
import { attendanceRequest } from '../attendance-api';
import { courseText } from '../course-utils';

export default function SessionAttendanceResults({ data, path, text, language, busy, onBusyChange, load, onSessionExpired, onNotice }) {
    const [review, setReview] = useState(null);
    const [includeChanged, setIncludeChanged] = useState(false);
    const [progress, setProgress] = useState(null);
    const [issue, setIssue] = useState('');
    const dialog = useRef(null);
    const mounted = useRef(true);
    const pending = useRef(false);
    useEffect(function lifecycle() { mounted.current = true; return () => { mounted.current = false; }; }, []);
    useEffect(function showReview() { if (review) dialog.current.showModal(); else dialog.current?.close(); }, [review]);

    async function prepare() {
        if (pending.current) return;
        pending.current = true;
        onBusyChange(true);
        setIssue('');
        try {
            const fresh = await load();
            if (fresh && mounted.current) { setIncludeChanged(false); setReview(fresh); }
        } finally { pending.current = false; if (mounted.current) onBusyChange(false); }
    }
    async function send() {
        if (pending.current) return;
        pending.current = true;
        onBusyChange(true);
        const targets = review.participants.filter(row => row.result_mail.actionable && (!row.result_mail.changed || includeChanged));
        setReview(null);
        setProgress({ done: 0, total: targets.length });
        let done = 0;
        try {
            for (const row of targets) {
                if (!mounted.current) break;
                try {
                    await attendanceRequest(`${path}/result-email`, 'POST', { registration_id: row.id, original_entry: row.entry,
                        previous_snapshot_id: row.result_mail.snapshot_id, confirm_changed: row.result_mail.changed && includeChanged });
                } catch (error) {
                    if (error.status === 401) { onSessionExpired(); throw error; }
                    if (!error.status || error.status >= 500) throw error;
                    if (mounted.current) setIssue(error.code || 'resultInterrupted');
                }
                done++;
                if (mounted.current) setProgress({ done, total: targets.length });
            }
            if (mounted.current) onNotice('resultComplete');
        } catch { if (mounted.current) { setIssue('resultInterrupted'); onNotice('resultInterrupted', 'error'); } }
        finally { pending.current = false; if (mounted.current) { onBusyChange(false); await load(); } }
    }
    const rows = review?.participants || [];
    const available = rows.filter(row => row.result_mail.actionable);
    const changed = available.filter(row => row.result_mail.changed).length;
    const retry = available.filter(row => !row.result_mail.changed && row.result_mail.status === 'failed').length;
    const fresh = available.length - changed - retry;
    return <>
        <button type="button" className="secondary-button" disabled={busy || !data?.results_can_send || !data.participants.some(row => row.result_mail.actionable)} onClick={prepare}>{text.resultSend}</button>
        <div className="attendance-result-summary">
            {!data?.results_can_send && <p className="attendance-note">{text.resultWindow}</p>}
            {issue && <p className="feedback error" role="alert">{text[issue] || text.resultInterrupted}</p>}
            {progress && <p role="status">{text.resultSending}: {progress.done}/{progress.total}</p>}
        </div>
        <dialog ref={dialog} className="attendance-result-dialog" aria-label={text.resultReview} onCancel={() => setReview(null)}>
            {review && <><h3>{text.resultReview}</h3><p>{courseText(review.session.topic, language)}</p><p>{text.resultNote}</p>
                <dl className="admin-fields"><div><dt>{text.resultNew}</dt><dd>{fresh}</dd></div><div><dt>{text.resultRetry}</dt><dd>{retry}</dd></div>
                    <div><dt>{text.resultChanged}</dt><dd>{changed}</dd></div><div><dt>{text.resultSkipped}</dt><dd>{rows.length - available.length}</dd></div></dl>
                {changed > 0 && <label className="attendance-result-choice"><input type="checkbox" checked={includeChanged} onChange={event => setIncludeChanged(event.target.checked)} />{text.resultInclude}</label>}
                <p className="attendance-note">{text.resultSafety}</p><div className="attendance-actions">
                    <button type="button" disabled={!fresh && !retry && !(changed && includeChanged)} onClick={send}>{text.resultConfirm}</button>
                    <button type="button" className="secondary-button" onClick={() => setReview(null)}>{text.resultCancel}</button></div></>}
        </dialog>
    </>;
}
