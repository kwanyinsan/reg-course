import { useCallback, useEffect, useRef, useState } from 'react';
import { attendanceRequest, attendanceToken } from '../attendance-api';
import { courseText, formatCourseDate } from '../course-utils';

export default function AttendanceScanner({ accessKey, text, language, onNotice }) {
    const token = attendanceToken(accessKey);
    const [data, setData] = useState(null);
    const [issue, setIssue] = useState('');
    const [camera, setCamera] = useState('off');
    const [saving, setSaving] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const video = useRef(null);
    const scanner = useRef(null);
    const mounted = useRef(true);
    const generation = useRef(0);
    const pending = useRef(false);
    const dispose = useCallback(function disposeCamera() {
        generation.current++;
        scanner.current?.destroy();
        scanner.current = null;
    }, []);
    const stop = useCallback(function stopCamera() {
        dispose();
        setCamera('off');
    }, [dispose]);

    useEffect(function load() {
        let ignore = false;
        mounted.current = true;
        attendanceRequest('attendance', 'GET', undefined, token).then(function loaded(result) {
            if (!ignore) { setData(result); setIssue(''); }
        }).catch(function failed(error) { if (!ignore) { setData(null); setIssue(error.code || 'attendance_unavailable'); } });
        return function cleanup() { ignore = true; mounted.current = false; dispose(); };
    }, [token, refresh, dispose]);

    async function scanned(value) {
        if (pending.current || !mounted.current) return;
        const decoded = typeof value === 'string' ? value : value.data;
        if (!decoded?.startsWith('reg-course-attendance:') || decoded.length > 1100) { setIssue('attInvalidQr'); return; }
        pending.current = true;
        stop();
        setSaving(true);
        setIssue('');
        try {
            const result = await attendanceRequest('attendance/record', 'POST', { qr_token: decoded.slice(22) }, token);
            if (mounted.current) { setData(result); onNotice(result.repeated ? 'attAlready' : 'attSuccess'); }
        } catch (error) { if (mounted.current) setIssue(error.code || 'attendance_unavailable'); }
        finally { pending.current = false; if (mounted.current) setSaving(false); }
    }

    async function start() {
        const current = ++generation.current;
        setIssue('');
        setCamera('waiting');
        try {
            const { default: QrScanner } = await import('qr-scanner');
            if (!mounted.current || current !== generation.current) return;
            const instance = new QrScanner(video.current, scanned, { preferredCamera: 'environment', returnDetailedScanResult: true, maxScansPerSecond: 5 });
            scanner.current = instance;
            await instance.start();
            if (!mounted.current || current !== generation.current) { instance.destroy(); return; }
            setCamera('on');
        } catch {
            if (mounted.current && current === generation.current) { stop(); setIssue('attCameraPermission'); }
        }
    }

    async function image(event) {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        stop();
        setIssue('');
        try {
            const { default: QrScanner } = await import('qr-scanner');
            await scanned(await QrScanner.scanImage(file, { returnDetailedScanResult: true }));
        } catch { if (mounted.current) setIssue('attInvalidQr'); }
    }

    return <section className="attendance-scanner" aria-busy={saving}>
        {issue && <p className="feedback error" role="alert">{text[issue] || text.attendance_unavailable}</p>}
        {!data && !issue && <p role="status">{text.attLoading}</p>}
        {data && <>
            <dl className="admin-fields"><div><dt>{text.attName}</dt><dd>{data.participant_name}</dd></div>
                <div><dt>{text.course}</dt><dd>{data.course.code} — {courseText(data.course.title, language)}</dd></div>
                <div><dt>{text.session}</dt><dd>{courseText(data.session.topic, language)}</dd></div>
                <div><dt>{text.attCloses}</dt><dd>{formatCourseDate(data.closes_at, language, true)}</dd></div></dl>
            <p>{text.hongKongTime}</p>
            {data.entry ? <div className="attendance-success" role="status"><h2>{text.attSuccess}</h2><p>{text.attTime}: {formatCourseDate(data.entry.recorded_at, language, true)}</p></div> : <>
                <p>{text.attScannerHelp}</p>
                <p>{text.attLinkPrivacy}</p>
                <video ref={video} className={camera === 'off' ? 'attendance-camera camera-off' : 'attendance-camera'} muted playsInline aria-label={text.attScanHelp} />
                {camera === 'waiting' && <p role="status">{text.attCameraWaiting}</p>}
                {camera === 'on' && <p role="status">{text.attScanHelp}</p>}
                <div className="attendance-actions">
                    {camera === 'off' ? <button type="button" disabled={saving} onClick={start}>{text.attStartScan}</button>
                        : <button type="button" onClick={stop}>{text.attStopScan}</button>}
                    <label className="attendance-image-label">{text.attUseImage}<input type="file" accept="image/*" disabled={saving} onChange={image} /></label>
                </div>
                <p className="attendance-note">{text.attCameraPrivacy}</p>
            </>}
        </>}
        <button type="button" className="secondary-button" disabled={saving} onClick={function reload() { stop(); setRefresh(value => value + 1); }}>{text.attCheckSaved}</button>
    </section>;
}
