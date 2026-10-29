import { useEffect, useRef, useState } from 'react';
import SiteLayout from './components/SiteLayout';
import LoginForm from './components/LoginForm';
import StaffArea from './components/StaffArea';
import translations from './translations';

function readLanguage() {
    try {
        const saved = localStorage.getItem('reg-course.language');
        if (Object.hasOwn(translations, saved)) return saved;
    } catch {
        // Language switching still works when browser storage is unavailable.
    }
    return 'en';
}

function readPage() {
    return window.location.hash === '#staff' ? 'staff' : 'home';
}

async function requestJson(path, options = {}) {
    const response = await fetch(`/api/${path}`, {
        ...options,
        signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(function invalidJson() { return null; });
    return { response, data };
}

function hasAdmin(data) {
    return Number.isInteger(data?.admin?.id) && typeof data.admin.username === 'string';
}

function errorKey(status) {
    if (status === 400 || status === 413 || status === 415) return 'invalidRequest';
    if (status === 401) return 'invalidCredentials';
    if (status === 403) return 'requestRejected';
    if (status === 429) return 'tooManyAttempts';
    return 'serverError';
}

const jsonHeaders = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'reg-course',
};

function App() {
    const [language, setLanguage] = useState(readLanguage);
    const [page, setPage] = useState(readPage);
    const [session, setSession] = useState({ status: 'checking', admin: null, notice: '' });
    const [sessionCheck, setSessionCheck] = useState(0);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [retryAt, setRetryAt] = useState(0);
    const operationPending = useRef(false);
    const sessionVersion = useRef(0);
    const text = { ...translations.en, ...translations[language] };
    const admin = session.status === 'ready' ? session.admin : null;
    const title = page === 'home' ? text.siteName : admin ? text.staffArea : text.staffLogin;

    useEffect(function updateDocument() {
        document.documentElement.lang = language;
        document.title = page === 'home' ? text.siteName : `${title} | ${text.siteName}`;
    }, [language, page, title, text.siteName]);

    useEffect(function watchNavigation() {
        function changePage() {
            setPage(readPage());
        }
        window.addEventListener('hashchange', changePage);
        return function stopWatching() { window.removeEventListener('hashchange', changePage); };
    }, []);

    useEffect(function restoreSession() {
        if (operationPending.current) return;
        let ignore = false;
        const version = sessionVersion.current;

        async function loadCurrentAdmin() {
            try {
                const { response, data } = await requestJson('current');
                if (ignore || version !== sessionVersion.current) return;
                if (response.ok && hasAdmin(data)) {
                    setSession({ status: 'ready', admin: data.admin, notice: '' });
                } else if (response.status === 401) {
                    setSession(function signedOut(previous) {
                        const notice = ['sessionExpired', 'loggedOut', 'logoutWarning'].includes(previous.notice)
                            ? previous.notice : '';
                        return { status: 'ready', admin: null,
                            notice: previous.notice === 'logoutUnknown' ? 'loggedOut'
                                : previous.admin ? 'sessionExpired' : notice };
                    });
                } else {
                    setSession(function cannotVerify(previous) {
                        return { ...previous, status: 'error',
                            notice: previous.notice === 'logoutUnknown' ? 'logoutUnknown' : 'sessionError' };
                    });
                }
            } catch {
                if (!ignore && version === sessionVersion.current) {
                    setSession(function cannotConnect(previous) {
                        return { ...previous, status: 'error', notice: previous.notice === 'logoutUnknown'
                            ? 'logoutUnknown' : 'sessionConnectionError' };
                    });
                }
            }
        }

        loadCurrentAdmin();
        return function ignoreOldResponse() { ignore = true; };
    }, [sessionCheck, page]);

    useEffect(function watchSessionExpiry() {
        if (!admin || busy) return;
        function checkVisibleSession() {
            if (document.visibilityState === 'visible') {
                setSessionCheck(function increment(previous) { return previous + 1; });
            }
        }
        const interval = setInterval(checkVisibleSession, 60000);
        window.addEventListener('focus', checkVisibleSession);
        document.addEventListener('visibilitychange', checkVisibleSession);
        return function stopWatching() {
            clearInterval(interval);
            window.removeEventListener('focus', checkVisibleSession);
            document.removeEventListener('visibilitychange', checkVisibleSession);
        };
    }, [admin, busy]);

    function changeLanguage(nextLanguage) {
        setLanguage(nextLanguage);
        try {
            localStorage.setItem('reg-course.language', nextLanguage);
        } catch {
            // Saving a preference is optional; no credentials are stored here.
        }
    }

    function retrySession() {
        setSession(function checking(previous) { return { ...previous, status: 'checking' }; });
        setSessionCheck(function increment(previous) { return previous + 1; });
    }

    async function handleLogin(username, password) {
        if (operationPending.current || Date.now() < retryAt) return;
        operationPending.current = true;
        sessionVersion.current += 1;
        setBusy(true);
        setFeedback('');
        try {
            const { response, data } = await requestJson('login', {
                method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username, password }),
            });
            if (response.ok && hasAdmin(data)) {
                setSession({ status: 'ready', admin: data.admin, notice: '' });
            } else {
                setFeedback(errorKey(response.status));
                if (response.status === 429) {
                    const seconds = Number(response.headers.get('Retry-After'));
                    setRetryAt(Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 900) * 1000);
                }
            }
        } catch {
            setFeedback('connectionError');
        } finally {
            operationPending.current = false;
            setBusy(false);
        }
    }

    async function handleLogout() {
        if (operationPending.current) return;
        operationPending.current = true;
        sessionVersion.current += 1;
        setBusy(true);
        setFeedback('');
        try {
            let failedStatus;
            try {
                const { response } = await requestJson('logout', {
                    method: 'POST', headers: jsonHeaders, body: '{}',
                });
                if (response.ok || response.status === 401) {
                    setSession({ status: 'ready', admin: null, notice: 'loggedOut' });
                    return;
                }
                failedStatus = response.status;
            } catch {
                // A lost response does not tell us whether the server destroyed the session.
            }
            try {
                const { response, data } = await requestJson('current');
                if (response.status === 401) {
                    setSession({ status: 'ready', admin: null,
                        notice: failedStatus >= 500 ? 'logoutWarning' : 'loggedOut' });
                } else if (response.ok && hasAdmin(data)) {
                    setSession({ status: 'ready', admin: data.admin, notice: '' });
                    setFeedback('logoutError');
                } else {
                    setSession(function uncertain(previous) {
                        return { ...previous, status: 'error', notice: 'logoutUnknown' };
                    });
                }
            } catch {
                setSession(function uncertain(previous) {
                    return { ...previous, status: 'error', notice: 'logoutUnknown' };
                });
            }
        } finally {
            operationPending.current = false;
            setBusy(false);
        }
    }

    return (
        <SiteLayout text={text} language={language} onLanguageChange={changeLanguage}
            page={page} admin={admin} title={title}>
            {page === 'home' ? (
                <section className="public-entry">
                    <p>{text.homeNotice}</p>
                    <a className="button" href="#staff">{admin ? text.staffArea : text.staffLogin}</a>
                </section>
            ) : session.status === 'checking' ? (
                <section className="session-panel" aria-busy="true">
                    <p role="status">{text.checkingSession}</p>
                </section>
            ) : session.status === 'error' ? (
                <section className="session-panel">
                    <p className="feedback error" role="alert">{text[session.notice]}</p>
                    <button type="button" onClick={retrySession}>{text.tryAgain}</button>
                </section>
            ) : admin ? (
                <StaffArea text={text} admin={admin} busy={busy} feedback={feedback} onLogout={handleLogout} />
            ) : (
                <LoginForm text={text} busy={busy} feedback={feedback}
                    notice={session.notice} retryAt={retryAt} onLogin={handleLogin} />
            )}
        </SiteLayout>
    );
}

export default App;
