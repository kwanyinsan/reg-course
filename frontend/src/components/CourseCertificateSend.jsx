import { useCallback, useEffect, useRef, useState } from 'react';
import { certificateRequest } from '../certificate-issue-api';

export default function CourseCertificateSend({ courseId, text, onSessionExpired, onNotice }) {
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [issue, setIssue] = useState('');
    const [progress, setProgress] = useState(null);
    const mounted = useRef(true);
    const pending = useRef(false);
    const path = `courses/${courseId}/certificates`;
    const load = useCallback(async function loadStatus() {
        const result = await certificateRequest(path);
        if (mounted.current) setData(result);
        return result;
    }, [path]);
    useEffect(function initialise() {
        mounted.current = true;
        async function read() {
            try { await load(); }
            catch (error) { if (mounted.current) { if (error.status === 401) onSessionExpired(); setIssue('certSendFailed'); } }
        }
        read();
        return () => { mounted.current = false; };
    }, [load, onSessionExpired]);

    async function send() {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setIssue('');
        const failures = new Map();
        try {
            const current = await load();
            const targets = current.participants.filter(row => row.actionable);
            setProgress({ done: 0, total: targets.length });
            let done = 0;
            for (const row of targets) {
                if (!mounted.current) break;
                try {
                    const result = await certificateRequest(`${path}/send`, 'POST', { registration_id: row.id });
                    const reasons = result.email.code?.startsWith('certificate_') ? [result.email.code] : [];
                    if (reasons.length) failures.set(row.id, reasons);
                    if (mounted.current) setData(previous => ({ participants: previous.participants.map(item => item.id === row.id ? { ...item, certificate: result.certificate, email: result.email, actionable: false, reasons } : item) }));
                } catch (error) {
                    if (error.status === 401) { onSessionExpired(); break; }
                    if (!error.status || error.status >= 500) throw error;
                    failures.set(row.id, error.reasons || [error.code]);
                    if (mounted.current) setData(previous => ({ participants: previous.participants.map(item => item.id === row.id ? { ...item, actionable: false, reasons: failures.get(row.id) } : item) }));
                }
                done++;
                if (mounted.current) setProgress({ done, total: targets.length });
            }
            if (mounted.current) onNotice('certSendComplete');
        } catch (error) {
            if (mounted.current) { if (error.status === 401) onSessionExpired(); setIssue('certSendInterrupted'); onNotice('certSendInterrupted', 'error'); }
        } finally {
            pending.current = false;
            if (mounted.current) {
                setBusy(false);
                try {
                    await load();
                    if (failures.size) setData(previous => ({ participants: previous.participants.map(row => failures.has(row.id) ? { ...row, reasons: [...new Set([...row.reasons, ...failures.get(row.id)])] } : row) }));
                } catch { setIssue('certSendFailed'); }
            }
        }
    }
    const rows = data?.participants || [];
    const ready = rows.filter(row => row.actionable).length;
    const emails = {};
    for (const row of rows) if (row.certificate) emails[row.email.status] = (emails[row.email.status] || 0) + 1;
    return <section className="course-section certificate-send" aria-busy={busy}>
        <h3>{text.certificate}</h3>
        <button type="button" disabled={busy || !ready} onClick={send}>{busy ? text.certSending : text.certSend}</button>
        <p>{text.certSendNote}</p><p className="certificate-send-note">{text.certSendSafety}</p>
        {issue && <p className="feedback error" role="alert">{text[issue]}</p>}
        {!data ? <p role="status">{text.certSendLoading}</p> : <>
            {!rows.length ? <p>{text.certSendNoStudents}</p> : <p>{text.certSendEligible}: {ready} · {text.certSendIssued}: {rows.filter(row => row.certificate).length} · {text.certSendExcluded}: {rows.filter(row => row.reasons.length).length}</p>}
            {progress && <p role="status">{text.certSendProgress}: {progress.done}/{progress.total}</p>}
            {!!Object.keys(emails).length && <><p>{text.certSendEmail}: {Object.entries(emails).map(([key, count]) => `${text[`certMail_${key}`]}: ${count}`).join(' · ')}</p><p className="certificate-send-note">{text.certSendMailNote}</p></>}
            {!!rows.length && <details><summary>{text.certSendDetails}</summary><ul className="certificate-send-results">{rows.map(row => <li key={row.id}>
                <a href={`#admin/registrations/${row.id}`}>{row.full_name}</a> — {row.reference}
                {row.certificate && <p>{row.certificate.number} — {text[`certMail_${row.email.status}`]}</p>}
                {!!row.reasons.length && <ul>{row.reasons.map(reason => <li key={reason}>{text[`certReason_${reason}`] || text.certSendFailed}</li>)}</ul>}
            </li>)}</ul></details>}
        </>}
    </section>;
}
