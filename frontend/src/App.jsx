import { useCallback, useEffect, useRef, useState } from 'react';
import SiteLayout from './components/SiteLayout';
import LoginForm from './components/LoginForm';
import AdminArea from './components/AdminArea';
import CourseList from './components/CourseList';
import CourseDetails from './components/CourseDetails';
import SelectedCourses from './components/SelectedCourses';
import Registration from './components/Registration';
import Payment from './components/Payment';
import Notification from './components/Notification';
import useNotification from './use-notification';
import applicationText from './application-text';
import paymentText from './payment-text';
import { capturePaymentLink } from './payment-link';
import { courseText, feeCents, formatMoney, readSelectedIds } from './course-utils';
import translations from './translations';
import { questionDraftDirty } from './question-utils';

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
    if (/^#payment(?:\/|$)/.test(window.location.hash)) return `payment/${capturePaymentLink()}`;
    const page = window.location.hash.slice(1).replace(/^staff(?=\/|$)/, 'admin');
    if (!page || page === 'home') return 'courses';
    if (['courses', 'selected', 'admin', 'registration', 'registration/review', 'registration/acknowledgement'].includes(page)) return page;
    if (/^courses\/[1-9]\d*$/.test(page) && Number(page.split('/')[1]) <= 2147483647) return page;
    if (/^admin\/(courses|registrations)(\/[1-9]\d*)?$/.test(page) &&
        (!page.split('/')[2] || Number(page.split('/')[2]) <= 2147483647)) return page;
    if (/^admin\/courses\/[1-9]\d*\/questions$/.test(page) && Number(page.split('/')[2]) <= 2147483647) return page;
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
    const [notification, notify] = useNotification();
    const [questionDraft, setQuestionDraft] = useState(null);
    const [applicationDraft, setApplicationDraft] = useState(null);
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
    const [detailCourse, setDetailCourse] = useState(null);
    const selectionPending = useRef(false);
    const catalogVersion = useRef(0);
    const text = { ...translations.en, ...translations[language], ...applicationText.en, ...applicationText[language], ...paymentText.en, ...paymentText[language] };
    const applicationPage = page === 'registration' || page.startsWith('registration/');
    const paymentPage = page.startsWith('payment/');
    const applicationCompleted = useCallback(function clearSubmittedSelection() {
        setSelection({ ids: [], notice: '' });
    }, []);
    async function beginApplication() {
        if (selectionPending.current) return;
        if (applicationDraft?.pendingPayload) { window.location.hash = 'registration/review'; return; }
        if (applicationDraft?.receipt) {
            selectionPending.current = true;
            setSelectionBusy(true);
            try {
                // A deliberate new selection after a known completion starts a fresh browser context.
                const { response } = await requestJson('application/new', {
                    method: 'POST', headers: jsonHeaders, body: '{}',
                });
                if (!response.ok) throw new Error('Cannot start another application.');
                setApplicationDraft(null);
            } catch {
                notify('applicationLoadError', 'error');
                return;
            } finally {
                selectionPending.current = false;
                setSelectionBusy(false);
            }
        } else {
            const previousIds = applicationDraft?.definition?.courses.map(function id(course) { return course.id; }).sort(function ascending(a, b) { return a - b; });
            if (JSON.stringify(previousIds) !== JSON.stringify([...selection.ids].sort(function ascending(a, b) { return a - b; }))) {
                setApplicationDraft(function update(previous) { return previous ? { ...previous, definition: null, review_token: null } : null; });
            }
        }
        if (window.location.hash === '#selected') window.location.hash = 'registration';
    }
    const admin = session.status === 'ready' ? session.admin : null;
    const adminPage = page === 'admin' || page.startsWith('admin/');
    const expireAdminSession = useCallback(function expireSession() {
        sessionVersion.current += 1;
        setSession({ status: 'ready', admin: null, notice: 'sessionExpired' });
    }, []);
    const detailId = page.startsWith('courses/') ? Number(page.split('/')[1]) : null;
    const currentCourse = detailCourse?.id === detailId ? detailCourse
        : catalog.courses.find(function matchingCourse(course) { return course.id === detailId; });
    const selectedCourses = catalog.courses.filter(function selectedCourse(course) {
        return selection.ids.includes(course.id);
    });
    const total = selectedCourses.reduce(function addFee(sum, course) { return sum + feeCents(course.fee); }, 0);
    let title = text.courses;
    if (adminPage) title = !admin ? text.adminLogin : page.endsWith('/questions') ? text.registrationQuestions : page.startsWith('admin/registrations/') ? text.registrationDetails
        : page === 'admin/registrations' ? text.registrations : page.startsWith('admin/courses/') ? text.courseWorkspace : text.adminCourses;
    else if (applicationPage) title = applicationDraft?.receipt || page.endsWith('/acknowledgement') ? text.acknowledgement : page.endsWith('/review') ? text.reviewApplication : text.applicationTitle;
    else if (paymentPage) title = text.paymentTitle;
    else if (page === 'selected') title = text.selectedCourses;
    else if (detailId) title = courseText(currentCourse?.title, language) || text.courseDetails;
    else if (page === 'notFound') title = text.pageNotFound;

    useEffect(function updateDocument() {
        document.documentElement.lang = language;
        document.title = `${title} | ${adminPage ? text.adminTitle : text.siteName}`;
    }, [language, page, title, adminPage, text.siteName, text.adminTitle]);

    useEffect(function watchNavigation() {
        function changePage() {
            if (/^#staff(?:\/|$)/.test(window.location.hash)) {
                window.location.replace(window.location.hash.replace(/^#staff/, '#admin'));
                return;
            }
            setPage(readPage());
            requestAnimationFrame(function focusPage() {
                document.getElementById('page-title')?.focus();
                window.scrollTo(0, 0);
            });
        }
        window.addEventListener('hashchange', changePage);
        window.addEventListener('popstate', changePage);
        // Old bookmarks resolve to the canonical admin URL without adding a history entry.
        if (/^#staff(?:\/|$)/.test(window.location.hash)) {
            window.location.replace(window.location.hash.replace(/^#staff/, '#admin'));
        }
        return function stopWatching() {
            window.removeEventListener('hashchange', changePage);
            window.removeEventListener('popstate', changePage);
        };
    }, []);

    useEffect(function saveSelection() {
        try {
            localStorage.setItem('reg-course.selectedCourseIds', JSON.stringify(selection.ids));
        } catch {
            // Selection remains usable for this visit when storage is unavailable.
        }
    }, [selection.ids]);

    useEffect(function announceSelection() {
        if (selection.notice) notify(selection.notice);
    }, [selection, notify]);

    useEffect(function announceSession() {
        if (session.status === 'ready' && session.notice) notify(session.notice);
    }, [session.status, session.notice, notify]);

    const dirtyQuestions = questionDraftDirty(questionDraft);
    useEffect(function warnBeforeClosing() {
        if (!dirtyQuestions && (!applicationDraft?.personal || applicationDraft?.receipt)) return;
        function warn(event) { event.preventDefault(); event.returnValue = ''; }
        window.addEventListener('beforeunload', warn);
        return function stopWarning() { window.removeEventListener('beforeunload', warn); };
    }, [dirtyQuestions, applicationDraft]);

    useEffect(function loadPublicCourses() {
        if (page === 'admin' || page.startsWith('admin/') || page.startsWith('registration') || page.startsWith('payment/') || page === 'notFound') return;
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
    }

    function clearSelectedCourses() {
        if (selectionPending.current) return;
        setSelection({ ids: [], notice: 'allCoursesCleared' });
    }

    async function toggleCourse(course) {
        if (selectionPending.current) return;
        if (selection.ids.includes(course.id)) return removeCourse(course.id);
        selectionPending.current = true;
        setSelectionBusy(true);
        try {
            const { response, data } = await requestJson(`courses/${course.id}`);
            if (!response.ok || data?.course?.availability !== 'open') {
                notify(response.ok || response.status === 404 ? 'courseNotSelectable' : 'courseLoadError', 'error');
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
            notify('courseLoadError', 'error');
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
        try {
            const { response, data } = await requestJson('login', {
                method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username, password }),
            });
            if (response.ok && hasAdmin(data)) {
                setQuestionDraft(function keepOwnDraft(previous) { return previous?.adminId === data.admin.id ? previous : null; });
                setSession({ status: 'ready', admin: data.admin, notice: '' });
                notify('loggedIn');
            } else {
                notify(errorKey(response.status), 'error');
                if (response.status === 429) {
                    const seconds = Number(response.headers.get('Retry-After'));
                    setRetryAt(Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 900) * 1000);
                }
            }
        } catch {
            notify('connectionError', 'error');
        } finally {
            operationPending.current = false;
            setBusy(false);
        }
    }

    async function handleLogout() {
        if (operationPending.current) return;
        if (dirtyQuestions && !window.confirm(text.confirmLogoutQuestions)) return;
        operationPending.current = true;
        sessionVersion.current += 1;
        setBusy(true);
        try {
            let failedStatus;
            try {
                const { response } = await requestJson('logout', {
                    method: 'POST', headers: jsonHeaders, body: '{}',
                });
                if (response.ok || response.status === 401) {
                    setQuestionDraft(null);
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
                    setQuestionDraft(null);
                    setSession({ status: 'ready', admin: null,
                        notice: failedStatus >= 500 ? 'logoutWarning' : 'loggedOut' });
                } else if (response.ok && hasAdmin(data)) {
                    setSession({ status: 'ready', admin: data.admin, notice: '' });
                    notify('logoutError', 'error');
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
            <Notification notice={notification} text={text} />
            {!adminPage ? (
                <>
                    {page === 'notFound' ? <a href="#courses">{text.backToCourses}</a> : paymentPage ? (
                        <Payment key={page} accessKey={page.split('/')[1]} text={text} language={language} onNotice={notify} />
                    ) : applicationPage ? (
                        <Registration page={page} text={text} language={language} initialSelectedIds={selection.ids}
                            draft={applicationDraft} onDraftChange={setApplicationDraft} onCompleted={applicationCompleted} onNotice={notify} />
                    ) : (
                        <>
                            {page !== 'selected' && <div className="selection-toolbar">
                                <span>{text.selectedCount}: {selection.ids.length}</span>
                                <div className="selection-money">
                                    {catalog.status === 'ready' && <span>{text.total}: {formatMoney(total, language)}</span>}
                                {page === 'courses' && <button type="button" className="secondary-button"
                                    disabled={selectionBusy || !selection.ids.length} onClick={clearSelectedCourses}>{text.clearAllCourses}</button>}
                                </div>
                                <a className="button selection-apply" href="#selected">{text.apply}</a>
                            </div>}
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
                                        busy={selectionBusy} onRemove={removeCourse} onStart={beginApplication} />
                                ) : (
                                    <CourseList courses={catalog.courses} text={text} language={language} filters={filters}
                                        onFilter={setFilters} selectedIds={selection.ids} busy={selectionBusy} onToggle={toggleCourse} onRefresh={retryCourses} />
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
                <AdminArea key={admin.id} text={text} language={language} page={page} admin={admin} busy={busy}
                    onNotice={notify} onLogout={handleLogout} onSessionExpired={expireAdminSession}
                    questionDraft={questionDraft} onQuestionDraftChange={setQuestionDraft} />
            ) : (
                <LoginForm text={text} busy={busy} retryAt={retryAt} onLogin={handleLogin} />
            )}
        </SiteLayout>
    );
}

export default App;
