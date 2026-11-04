function SiteLayout({ text, language, onLanguageChange, page, admin, title, selectedCount, children }) {
    const adminPage = page === 'admin' || page.startsWith('admin/');
    const paymentPage = page.startsWith('payment/');
    const standalonePage = paymentPage || page.startsWith('attendance/');
    if (admin && page.endsWith('/qr')) return <main id="main-content" className="attendance-fullscreen" tabIndex="-1">{children}</main>;
    let backLink = null;
    if (page.startsWith('courses/')) backLink = { href: '#courses', label: text.backToCourses, parent: text.courses };
    if (adminPage && admin) {
        if (page.endsWith('/questions') || page.endsWith('/certificate')) backLink = { href: `#admin/courses/${page.split('/')[2]}`, label: text.backToCourse, parent: text.courseDetails };
        else if (page.startsWith('admin/courses/')) backLink = { href: '#admin/courses', label: text.backToCourses, parent: text.courses };
        else if (page.startsWith('admin/registrations/')) backLink = { href: '#admin/registrations', label: text.backToRegistrations, parent: text.registrations };
    }
    const languages = [
        { code: 'en', label: 'EN', name: 'English' },
        { code: 'zh-Hant', label: '繁', name: '繁體中文' },
        { code: 'zh-Hans', label: '简', name: '简体中文' },
    ];
    const languageControls = <div className="language-controls" role="group" aria-label={text.language}>
        {languages.map(function languageButton(item) {
            return <button type="button" key={item.code} lang={item.code}
                aria-label={item.name} aria-pressed={language === item.code}
                onClick={function chooseLanguage() { onLanguageChange(item.code); }}>{item.label}</button>;
        })}
    </div>;

    return (
        <div className="site-layout">
            <a className="skip-link" href="#main-content" onClick={function skipToContent(event) {
                event.preventDefault();
                document.getElementById('main-content').focus();
            }}>{text.skipToContent}</a>
            {!standalonePage && <header className="site-header">
                <div className="header-content content-width">
                    <a className="site-name" href={adminPage ? admin ? '#admin/courses' : '#admin' : '#courses'}>{adminPage ? text.adminArea : text.siteName}</a>
                    <div className="header-actions">
                        {languageControls}
                    </div>
                </div>
                {(!adminPage || admin) && <nav className="site-navigation content-width" aria-label={text.mainNavigation}>
                    {adminPage ? <>
                        {admin && <><a href="#admin/courses" aria-current={page === 'admin' || page.startsWith('admin/courses') ? 'page' : undefined}>{text.adminCourses}</a>
                            <a href="#admin/registrations" aria-current={page.startsWith('admin/registrations') ? 'page' : undefined}>{text.registrations}</a>
                            <a href="#admin/activity" aria-current={page === 'admin/activity' ? 'page' : undefined}>{text.activity}</a></>}
                    </> : <>
                    <a href="#courses" aria-current={page.startsWith('courses') ? 'page' : undefined}>{text.courses}</a>
                    <a href="#selected" aria-current={page === 'selected' ? 'page' : undefined}>
                        {text.selectedCourses} ({selectedCount})
                    </a>
                    </>}
                </nav>}
            </header>}
            <main id="main-content" className={`main-content content-width${standalonePage ? ' standalone-content' : ''}`} tabIndex="-1">
                {standalonePage && <div className="standalone-language-controls">{languageControls}</div>}
                {page !== 'courses' && !standalonePage && (
                    <div className="page-navigation">
                    {backLink && <a className="page-back" href={backLink.href}>{backLink.label}</a>}
                    <nav className="breadcrumb" aria-label={text.breadcrumb}>
                        <ol>
                            <li><a href={backLink?.href || (adminPage ? admin ? '#admin/courses' : '#admin' : '#courses')}>{backLink?.parent || (adminPage ? text.adminArea : text.courses)}</a></li>
                            <li aria-current="page">{title}</li>
                        </ol>
                    </nav>
                    </div>
                )}
                <h1 id="page-title" tabIndex="-1">{title}</h1>
                {children}
            </main>
            {!standalonePage && <footer className="site-footer">
                <div className="content-width">{text.siteName}</div>
            </footer>}
        </div>
    );
}

export default SiteLayout;
