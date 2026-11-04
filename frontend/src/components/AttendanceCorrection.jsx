import { useState } from 'react';
import { attendanceRequest, hkInput, hkTimestamp } from '../attendance-api';

export default function AttendanceCorrection({ row, sessionId, text, onSaved, onCancel, onSessionExpired }) {
    const [time, setTime] = useState(hkInput(row.entry?.recorded_at || new Date()));
    const [reason, setReason] = useState('');
    const [clear, setClear] = useState(false);
    const [busy, setBusy] = useState(false);
    const [issue, setIssue] = useState('');
    async function submit(event) {
        event.preventDefault();
        setBusy(true);
        setIssue('');
        try {
            await attendanceRequest(`admin/registrations/${row.id}/attendance/${sessionId}`, 'PUT', {
                recorded_at: clear ? null : hkTimestamp(time), original_entry: row.entry, reason,
            });
            onSaved();
        } catch (error) {
            if (error.status === 401) onSessionExpired();
            setIssue(error.code || 'attendance_unavailable');
        } finally { setBusy(false); }
    }
    return <form className="attendance-correction" onSubmit={submit} aria-busy={busy}>
        <h4>{text.attCorrect}: {row.full_name}</h4>
        {issue && <p className="feedback error" role="alert">{text[issue] || text.attendance_unavailable}</p>}
        {clear ? <p role="status">{text.attClearConfirm}</p> : <label>{text.attTime}<input type="datetime-local" step="1" required value={time} onChange={event => setTime(event.target.value)} /></label>}
        <p>{text.hongKongTime}</p>
        <label>{text.attReason}<textarea required maxLength="500" value={reason} onChange={event => setReason(event.target.value)} /></label>
        <div className="attendance-actions"><button disabled={busy || !reason.trim()}>{clear ? text.attConfirmClear : text.attSave}</button>
            {row.entry && !clear && <button type="button" className="secondary-button" disabled={busy} onClick={() => setClear(true)}>{text.attClear}</button>}
            <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>{text.attCancel}</button></div>
    </form>;
}
