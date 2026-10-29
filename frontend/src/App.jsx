import { useEffect, useRef, useState } from 'react';
import SiteLayout from './components/SiteLayout';
import LoginForm from './components/LoginForm';
import StaffArea from './components/StaffArea';
import CourseList from './components/CourseList';
import CourseDetails from './components/CourseDetails';
import SelectedCourses from './components/SelectedCourses';
import { courseText, feeCents, formatMoney, readSelectedIds } from './course-utils';
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
    const page = window.location.hash.slice(1);
    if (!page || page === 'home') return 'courses';
    if (['courses', 'selected', 'staff'].includes(page)) return page;
    if (/^courses\/[1-9]\d*$/.test(page) && Number(page.split('/')[1]) <= 2147483647) return page;
    return 'notFound';
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
    const [catalog, setCatalog] = useState({ status: 'loading', courses: [] });
    const [courseRefresh, setCourseRefresh] = useState(0);
    const [filters, setFilters] = useState({ search: '', mode: '', availability: '' });
    const [selection, setSelection] = useState(function initialSelection() {
        return { ids: readSelectedIds(), notice: '' };
    });
    const [selectionBusy, setSelectionBusy] = useState(false);
    const [selectionError, setSelectionError] = useState('');
    const [detailCourse, setDetailCourse] = useState(null);
    const selectionPending = useRef(false);
    const catalogVersion = useRef(0);
    const text = { ...translations.en, ...translations[language] };
    const admin = session.status === 'ready' ? session.admin : null;
    const detailId = page.startsWith('courses/') ? Number(page.split('/')[1]) : null;
    const currentCourse = detailCourse?.id === detailId ? detailCourse
        : catalog.courses.find(function matchingCourse(course) { return course.id === detailId; });
    const selectedCourses = catalog.courses.filter(function selectedCourse(course) {
        return selection.ids.includes(course.id);
    });
    const total = selectedCourses.reduce(function addFee(sum, course) { return sum + feeCents(course.fee); }, 0);
    let title = text.courses;
    if (page === 'staff') title = admin ? text.staffArea : text.staffLogin;
    else if (page === 'selected') title = text.selectedCourses;
    else if (detailId) title = courseText(currentCourse?.title, language) || text.courseDetails;
    else if (page === 'notFound') title = text.pageNotFound;

    useEffect(function updateDocument() {
        document.documentElement.lang = language;
        document.title = `${title} | ${text.siteName}`;
    }, [language, page, title, text.siteName]);

    useEffect(function watchNavigation() {
        function changePage() {
            setPage(readPage());
            requestAnimationFrame(function focusPage() {
                document.getElementById('page-title')?.focus();
                window.scrollTo(0, 0);
            });
        }
        window.addEventListener('hashchange', changePage);
        return function stopWatching() { window.removeEventListener('hashchange', changePage); };
    }, []);

    useEffect(function saveSelection() {
        try {
            localStorage.setItem('reg-course.selectedCourseIds', JSON.stringify(selection.ids));
        } catch {
            // Selection remains usable for this visit when storage is unavailable.
        }
    }, [selection.ids]);

    useEffect(function loadPublicCourses() {
        if (page === 'staff' || page === 'notFound') return;
        let ignore = false;
        const version = ++catalogVersion.current;
        async function loadCourses() {
            try {
                const { response, data } = await requestJson('courses');
                if (ignore || version !== catalogVersion.current) return;
                if (!response.ok || !Array.isArray(data?.courses)) throw new Error('Course response unavailable.');
                setCatalog({ status: 'ready', courses: data.courses });
                setSelection(function validateSelection(previous) {
                    const ids = previous.ids.filter(function stillSelectable(id) {
                        return data.courses.some(function available(course) {
                            return course.id === id && course.availability === 'open';
                        });
                    });
                    return ids.length === previous.ids.length ? previous : { ids, notice: 'selectionUpdated' };
                });
            } catch {
                if (!ignore && version === catalogVersion.current) {
                    setCatalog(function cannotLoad(previous) { return { ...previous, status: 'error' }; });
                }
            }
        }
        loadCourses();
        return function ignoreOldResponse() { ignore = true; };
    }, [page, courseRefresh]);

    useEffect(function refreshVisibleCourses() {
        function refresh() {
            if (document.visibilityState === 'visible') {
                setCourseRefresh(function increment(previous) { return previous + 1; });
            }
        }
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return function stopWatching() {
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, []);

    function retryCourses() {
        setCatalog(function loading(previous) { return { ...previous, status: 'loading' }; });
        setCourseRefresh(function increment(previous) { return previous + 1; });
    }

    function removeCourse(id) {
        if (selectionPending.current) return;
        setSelection(function remove(previous) {
            return { ids: previous.ids.filter(function keep(value) { return value !== id; }), notice: 'courseRemoved' };
        });
        setSelectionError('');
    }

    async function toggleCourse(course) {
        if (selectionPending.current) return;
        if (selection.ids.includes(course.id)) return removeCourse(course.id);
        selectionPending.current = true;
        setSelectionBusy(true);
        setSelectionError('');
        try {
            const { response, data } = await requestJson(`courses/${course.id}`);
            if (!response.ok || data?.course?.availability !== 'open') {
                setSelectionError(response.ok || response.status === 404 ? 'courseNotSelectable' : 'courseLoadError');
                setCourseRefresh(function increment(previous) { return previous + 1; });
                return;
            }
            catalogVersion.current += 1;
            setCatalog(function refreshFee(previous) {
                return { ...previous, courses: previous.courses.map(function updated(item) {
                    return item.id === course.id ? data.course : item;
                }) };
            });
            setSelection(function add(previous) {
                return { ids: previous.ids.includes(course.id) ? previous.ids : [...previous.ids, course.id], notice: 'courseAdded' };
            });
        } catch {
            setSelectionError('courseLoadError');
        } finally {
            selectionPending.current = false;
            setSelectionBusy(false);
        }
    }

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
            page={page} admin={admin} title={title} selectedCount={selection.ids.length}>
            {page !== 'staff' ? (
                <>
                    <p className="course-demo-notice">{text.demoNotice}</p>
                    {page === 'notFound' ? <a href="#courses">{text.backToCourses}</a> : (
                        <>
                            <div className="selection-toolbar">
                                <span>{text.selectedCount}: {selection.ids.length}</span>
                                {catalog.status === 'ready' && <span>{text.total}: {formatMoney(total, language)}</span>}
                                <a href="#selected">{text.reviewSelection}</a>
                                <button type="button" className="secondary-button" onClick={retryCourses}>{text.refreshCourses}</button>
                            </div>
                            {selection.notice && <p className="feedback" role="status">{text[selection.notice]}</p>}
                            {selectionError && <p className="feedback error" role="alert">{text[selectionError]}</p>}
                            {selectionBusy && <p role="status">{text.checkingSelection}</p>}
                            {detailId && catalog.status === 'error' && <p role="alert">{text.courseLoadError}</p>}
                            {detailId ? (
                                <CourseDetails id={detailId} text={text} language={language}
                                    selected={selection.ids.includes(detailId)} busy={selectionBusy || catalog.status !== 'ready'}
                                    onToggle={toggleCourse} onLoaded={setDetailCourse} showTitle={!currentCourse} refresh={courseRefresh} />
                            ) : catalog.status === 'loading' ? <p role="status">{text.loadingCourses}</p>
                                : catalog.status === 'error' ? (
                                    <section className="course-error"><p role="alert">{text.courseLoadError}</p>
                                        <button type="button" onClick={retryCourses}>{text.tryAgain}</button></section>
                                ) : page === 'selected' ? (
                                    <SelectedCourses courses={selectedCourses} text={text} language={language}
                                        busy={selectionBusy} onRemove={removeCourse} />
                                ) : (
                                    <CourseList courses={catalog.courses} text={text} language={language} filters={filters}
                                        onFilter={setFilters} selectedIds={selection.ids} busy={selectionBusy} onToggle={toggleCourse} />
                                )}
                        </>
                    )}
                </>
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
