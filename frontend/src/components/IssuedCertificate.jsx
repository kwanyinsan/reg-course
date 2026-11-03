import { useEffect, useRef, useState } from 'react';
import { certificateRequest } from '../certificate-issue-api';
import { formatCourseDate } from '../course-utils';

export default function IssuedCertificate({ id, text, language, onSessionExpired }) {
    const [data, setData] = useState(null);
    const [issue, setIssue] = useState('');
    const [busy, setBusy] = useState(false);
    const url = useRef(null);
    const request = useRef(null);
    useEffect(function load() {
        let ignore = false;
        certificateRequest(`registrations/${id}/certificate`).then(result => { if (!ignore) setData(result); }).catch(function failed(error) {
            if (ignore) return;
            if (error.status === 401) onSessionExpired();
            setIssue('certSendFailed');
        });
        return function cleanup() { ignore = true; request.current?.abort(); if (url.current) URL.revokeObjectURL(url.current); };
    }, [id, onSessionExpired]);
    async function download() {
        setBusy(true);
        setIssue('');
        try {
            request.current = new AbortController();
            const response = await fetch(`/api/admin/registrations/${id}/certificate/pdf`, { signal: AbortSignal.any([request.current.signal, AbortSignal.timeout(30000)]) });
            if (response.status === 401) return onSessionExpired();
            if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/pdf')) throw new Error('Unavailable PDF.');
            const blob = await response.blob();
            if (url.current) URL.revokeObjectURL(url.current);
            url.current = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url.current;
            anchor.download = data.certificate.filename;
            anchor.click();
        } catch { setIssue('certReason_certificate_document_unavailable'); }
        finally { setBusy(false); }
    }
    const certificate = data?.certificate;
    return <div aria-busy={busy}>
        {issue && <p className="feedback error" role="alert">{text[issue]}</p>}
        {!data && !issue && <p role="status">{text.certSendLoading}</p>}
        {certificate && <><dl className="admin-fields">
            <div><dt>{text.certificateNumber}</dt><dd>{certificate.number}</dd></div>
            <div><dt>{text.issuedAt}</dt><dd>{formatCourseDate(certificate.issued_at, language, true)}</dd></div>
            <div><dt>{text.certSendName}</dt><dd>{certificate.participant_name}</dd></div>
            <div><dt>{text.certSendDate}</dt><dd>{certificate.issued_date}</dd></div>
            <div><dt>{text.certSendRecipient}</dt><dd>{certificate.recipient}</dd></div>
            <div><dt>{text.certSendEmail}</dt><dd>{text[`certMail_${data.email.status}`]}</dd></div>
        </dl>{certificate.pdf_available ? <button type="button" disabled={busy} onClick={download}>{text.certSendPdf}</button> : <p>{text.certReason_certificate_document_unavailable}</p>}
            <p className="certificate-send-note">{text.certSendMailNote}</p></>}
    </div>;
}
