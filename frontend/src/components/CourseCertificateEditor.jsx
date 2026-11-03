import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { courseText } from '../course-utils';
import { certificateSections, certificatePlaceholders, certificateLimits, cleanCertificate, certificateDraftDirty, validateCertificate } from '../certificate-utils';

const CertificatePdfPreview = lazy(function loadPdfViewer() { return import('./CertificatePdfPreview'); });

function loadedDraft(data, courseId, adminId) {
    return { courseId, adminId, originalTemplate: data.certificate?.template ?? null,
        starter: data.starter_template, template: structuredClone(data.certificate?.template || data.starter_template) };
}

function CourseCertificateEditor({ id, adminId, text, language, draft, onDraftChange, onSessionExpired, onNotice }) {
    const [result, setResult] = useState({ id: null, status: 'loading' });
    const [refresh, setRefresh] = useState(0);
    const [busy, setBusy] = useState(false);
    const [issue, setIssue] = useState(null);
    const [preview, setPreview] = useState(null);
    const [confirmation, setConfirmation] = useState(null);
    const pending = useRef(false);
    const live = useRef(true);
    const previewUrl = useRef(null);
    const replaceOnLoad = useRef(false);
    const active = useRef({ section: 'body', start: 0, end: 0 });
    const current = draft?.courseId === id && draft.adminId === adminId ? draft : null;
    const dirty = certificateDraftDirty(current);
    const signature = current?.template ? JSON.stringify(cleanCertificate(current.template)) : '';
    const outdated = Boolean(preview && preview.signature !== signature);

    useEffect(function loadTemplate() {
        let ignore = false;
        async function load() {
            try {
                const response = await fetch(`/api/admin/courses/${id}/certificate`, { signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (ignore) return;
                if (response.status === 401) return onSessionExpired();
                if (!response.ok || !data.course) throw new Error('Certificate unavailable.');
                const replace = replaceOnLoad.current;
                onDraftChange(function keepEdits(previous) {
                    return !replace && previous?.adminId === adminId && certificateDraftDirty(previous) ? previous : loadedDraft(data, id, adminId);
                });
                replaceOnLoad.current = false;
                setResult({ id, status: 'ready', data });
            } catch { if (!ignore) setResult({ id, status: 'error' }); }
        }
        load();
        return function ignoreOldResponse() { ignore = true; };
    }, [id, adminId, refresh, onDraftChange, onSessionExpired]);

    useEffect(function cleanPreview() {
        live.current = true;
        return function revoke() { live.current = false; if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); };
    }, []);

    function discardPreview() {
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = null;
        setPreview(null);
    }

    function showIssue(error) {
        setIssue(error);
        requestAnimationFrame(function focusError() {
            const target = certificateSections.includes(error.field) ? document.getElementById(`certificate-${error.field}`) : document.getElementById('certificate-error');
            target?.focus();
        });
    }

    async function perform(action) {
        if (pending.current || !current?.template) return;
        const template = cleanCertificate(current.template);
        const error = validateCertificate(template);
        if (error) return showIssue(error);
        pending.current = true;
        setBusy(true);
        setIssue(null);
        try {
            const response = await fetch(`/api/admin/courses/${id}/certificate${action === 'preview' ? '/preview' : ''}`, {
                method: action === 'preview' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'reg-course' },
                body: JSON.stringify(action === 'preview' ? { template } : { template, original_template: current.originalTemplate }), signal: AbortSignal.timeout(15000),
            });
            if (response.status === 401) { discardPreview(); return onSessionExpired(); }
            if (!response.ok) {
                const data = await response.json().catch(function invalidJson() { return {}; });
                if (data.code === 'template_locked') setResult(function lock(previous) { return { ...previous, data: { ...previous.data, editable: false } }; });
                return showIssue({ code: response.status === 413 ? 'template_too_large' : data.code || 'certificate_failed', field: data.field });
            }
            if (action === 'preview') {
                if (!response.headers.get('Content-Type')?.startsWith('application/pdf')) throw new Error('Invalid PDF response.');
                const blob = await response.blob();
                if (!live.current) return;
                if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
                previewUrl.current = URL.createObjectURL(blob);
                setPreview({ url: previewUrl.current, signature: JSON.stringify(template) });
            } else {
                const data = await response.json();
                onDraftChange(function saved(previous) { return previous?.courseId === id && previous.adminId === adminId ? loadedDraft(data, id, adminId) : previous; });
                setResult({ id, status: 'ready', data });
                onNotice('certificateUpdated');
            }
        } catch { showIssue({ code: action === 'preview' ? 'preview_failed' : 'save_unconfirmed' }); }
        finally { pending.current = false; setBusy(false); }
    }

    function confirmDiscard(action) {
        setConfirmation(action);
        requestAnimationFrame(function focusConfirmation() { document.getElementById('certificate-discard-confirmation')?.focus(); });
    }

    function reload(confirmed = false) {
        if (busy) return;
        if (dirty && !confirmed) return confirmDiscard('reload');
        setConfirmation(null);
        replaceOnLoad.current = true;
        discardPreview();
        setIssue(null);
        setResult({ id, status: 'loading' });
        setRefresh(function increment(previous) { return previous + 1; });
    }

    function insertPlaceholder(token) {
        const { section, start, end } = active.current;
        const value = current.template[section].en;
        const inserted = `{{${token}}}`;
        onDraftChange({ ...current, template: { ...current.template, [section]: { en: value.slice(0, start) + inserted + value.slice(end) } } });
        setIssue(null);
        requestAnimationFrame(function focusField() {
            const input = document.getElementById(`certificate-${section}`);
            input?.focus();
            input?.setSelectionRange(start + inserted.length, start + inserted.length);
        });
    }

    if (result.id !== id || result.status === 'loading') return <p role="status">{text.applicationLoading}</p>;
    if (result.status === 'error') return <section><p role="alert">{text.adminLoadError}</p><button type="button" onClick={function retry() { reload(); }}>{text.tryAgain}</button></section>;
    const { course, editable, certificate } = result.data;
    const discardConfirmation = confirmation && <div className="feedback" role="alert" tabIndex="-1" id="certificate-discard-confirmation">
        <p>{text.certificateDiscardConfirm}</p><div className="certificate-actions">
            <button type="button" className="secondary-button" onClick={function keep() { setConfirmation(null); }}>{text.certificateKeepEditing}</button>
            <button type="button" onClick={function discard() {
                if (confirmation === 'replace') { onDraftChange(loadedDraft(result.data, id, adminId)); setConfirmation(null); }
                else reload(true);
            }}>{text.certificateConfirmDiscard}</button>
        </div>
    </div>;
    if (!current) return <section><p>{text.certificateOtherDraft}</p><a href={`#admin/courses/${draft?.courseId}/certificate`}>{text.certificateReturnDraft}</a>
        <p><button type="button" onClick={function replace() { confirmDiscard('replace'); }}>{text.certificateOpenThis}</button></p>{discardConfirmation}</section>;
    return <section className="certificate-workspace" aria-busy={busy}>
        <h2>{courseText(course.title, language)}</h2><p className="course-code">{course.code}</p>
        <p className="certificate-state">{editable ? text.certificateEditable : text.certificateLocked} — {dirty ? text.unsavedChanges : certificate ? text.certificateSaved : text.certificateMissing}</p>
        <p>{text.certificateEnglishOnly}</p>
        {!editable && <p className="feedback">{certificate ? text.certificateLockedNote : text.certificateMissingLocked}</p>}
        {discardConfirmation}
        {issue && <p id="certificate-error" className="feedback error" role="alert" tabIndex="-1">
            {issue.field && `${text[`certificate${issue.field[0].toUpperCase() + issue.field.slice(1)}`]}: `}{text[`certificateError_${issue.code}`] || text.certificateError_certificate_failed}
        </p>}
        {busy && <p role="status">{text.applicationWorking}</p>}
        {current.template && <div className="certificate-editor-layout">
            <section aria-label={text.certificateTitle}>
                {certificateSections.map(function field(section) { return <div className="certificate-field" key={section}>
                    <label htmlFor={`certificate-${section}`}>{text[`certificate${section[0].toUpperCase() + section.slice(1)}`]}</label>
                    <textarea id={`certificate-${section}`} lang="en" rows={section === 'body' ? 9 : 3} maxLength={certificateLimits[section]}
                        value={current.template[section].en} readOnly={!editable} disabled={busy}
                        aria-invalid={issue?.field === section || undefined} aria-describedby={issue?.field === section ? 'certificate-error' : undefined}
                        onSelect={function remember(event) { active.current = { section, start: event.target.selectionStart, end: event.target.selectionEnd }; }}
                        onChange={function edit(event) { setIssue(null); onDraftChange({ ...current, template: { ...current.template, [section]: { en: event.target.value } } }); }} />
                    <span className="certificate-counter">{current.template[section].en.length} / {certificateLimits[section]}</span>
                </div>; })}
                {editable && <fieldset className="certificate-placeholders" disabled={busy}><legend>{text.certificateInsert}</legend>
                    {certificatePlaceholders.map(function token(token) { return <button type="button" className="secondary-button" key={token} onClick={function insert() { insertPlaceholder(token); }}>
                        {text[`certificateToken_${token}`]} <code>{`{{${token}}}`}</code></button>; })}
                </fieldset>}
                <div className="certificate-actions">
                    <button type="button" className="secondary-button" disabled={busy} onClick={function discard() { reload(); }}>{text.certificateReload}</button>
                    {editable && <button type="button" disabled={busy || (!dirty && Boolean(certificate))} onClick={function save() { perform('save'); }}>{text.certificateSave}</button>}
                </div>
            </section>
            <section className="certificate-preview" aria-labelledby="certificate-preview-heading">
                <h2 id="certificate-preview-heading">{text.certificatePreview}</h2>
                <p>{text.certificateSample}</p><p>{text.certificateNoPreview}</p>
                <button type="button" disabled={busy || (!editable && dirty)} onClick={function generate() { perform('preview'); }}>{text.certificateGenerate}</button>
                {preview && <>
                    {outdated ? <p role="status">{text.certificateOutdated}</p> : <>
                        <div className="certificate-actions"><a className="button secondary-button" href={preview.url} target="_blank" rel="noopener noreferrer">{text.certificateOpen}</a>
                            <a className="button secondary-button" href={preview.url} download={`certificate-preview-${id}.pdf`}>{text.certificateDownload}</a></div>
                        <Suspense fallback={<p role="status">{text.certificatePreviewLoading}</p>}>
                            <CertificatePdfPreview key={preview.url} url={preview.url} text={text} />
                        </Suspense>
                        <p>{text.certificatePdfFallback}</p>
                    </>}
                </>}
            </section>
        </div>}
    </section>;
}

export default CourseCertificateEditor;
