import { useEffect, useState } from 'react';
import { attendanceRequest } from '../attendance-api';
import { courseText, formatCourseDate } from '../course-utils';

export default function AttendanceQr({ id, sessionId, text, language, onSessionExpired }) {
    const [data, setData] = useState(null);
    const [issue, setIssue] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [now, setNow] = useState(Date.now);
    useEffect(function loadQr() {
        let ignore = false;
        async function load() {
            try {
                const result = await attendanceRequest(`admin/courses/${id}/attendance/${sessionId}/qr`);
                if (!ignore) { setData({ ...result, offset: new Date(result.server_time).getTime() - Date.now() }); setIssue(''); }
            } catch (error) {
                if (ignore) return;
                setData(null);
                if (error.status === 401) onSessionExpired();
                setIssue(error.code || 'attendance_unavailable');
            }
        }
        load();
        const interval = setInterval(load, 60000);
        return function cleanup() { ignore = true; clearInterval(interval); };
    }, [id, sessionId, refresh, onSessionExpired]);
    useEffect(function expiryClock() { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
    const valid = data && now + data.offset < new Date(data.expires_at).getTime();
    return <section className="attendance-qr-display">
        <a href={`#admin/courses/${id}`}>{text.attCloseDisplay}</a>
        <h1>{text.attTaking}</h1>
        {data && <><h2>{data.course.code} — {courseText(data.course.title, language)}</h2><p>{courseText(data.session.topic, language)}</p>
            <p>{formatCourseDate(data.session.starts_at, language, true)} – {formatCourseDate(data.session.ends_at, language, true)}</p></>}
        {valid ? <><img src={data.image} alt={text.attQrAlt} width="720" height="720" /><p>{text.attQrExpiry}: {formatCourseDate(data.expires_at, language, true)}</p><p>{text.hongKongTime}</p></>
            : <p role={issue || data ? 'alert' : 'status'}>{text[issue] || (data ? text.attConnectionWarning : text.attLoading)}</p>}
        <button type="button" className="secondary-button" onClick={() => setRefresh(value => value + 1)}>{text.attRefresh}</button>
    </section>;
}
