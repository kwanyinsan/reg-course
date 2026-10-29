function SiteLayout({ text, language, onLanguageChange, page, admin, title, selectedCount, children }) {
    const staffPage = page === 'staff' || page.startsWith('staff/');
    const languages = [
        { code: 'en', label: 'EN', name: 'English' },
        { code: 'zh-Hant', label: '繁', name: '繁體中文' },
        { code: 'zh-Hans', label: '简', name: '简体中文' },
    ];

    return (
        <div className="site-layout">
            <a className="skip-link" href="#main-content" onClick={function skipToContent(event) {
                event.preventDefault();
                document.getElementById('main-content').focus();
            }}>{text.skipToContent}</a>
            <header className="site-header">
                <div className="header-content content-width">
                    <a className="site-name" href="#courses">{text.siteName}</a>
                    <div className="header-actions">
                        <div className="language-controls" role="group" aria-label={text.language}>
                            {languages.map(function languageButton(item) {
                                return (
                                    <button type="button" key={item.code} lang={item.code}
                                        aria-label={item.name} aria-pressed={language === item.code}
                                        onClick={function chooseLanguage() { onLanguageChange(item.code); }}>
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>
                        <a className="button staff-access" href="#staff"
                            aria-current={staffPage ? 'page' : undefined}>
                            {admin ? text.staffArea : text.staffLogin}
                        </a>
                    </div>
                </div>
                <nav className="site-navigation content-width" aria-label={text.mainNavigation}>
                    {staffPage ? <>
                        {admin && <><a href="#staff/courses" aria-current={page === 'staff' || page.startsWith('staff/courses') ? 'page' : undefined}>{text.staffCourses}</a>
                            <a href="#staff/registrations" aria-current={page.startsWith('staff/registrations') ? 'page' : undefined}>{text.registrations}</a></>}
                        <a href="#courses">{text.publicCourses}</a>
                    </> : <>
                    <a href="#courses" aria-current={page.startsWith('courses') ? 'page' : undefined}>{text.courses}</a>
                    <a href="#selected" aria-current={page === 'selected' ? 'page' : undefined}>
                        {text.selectedCourses} ({selectedCount})
                    </a>
                    </>}
                </nav>
            </header>
            <main id="main-content" className="main-content content-width" tabIndex="-1">
                {page !== 'courses' && (
                    <nav className="breadcrumb" aria-label={text.breadcrumb}>
                        <ol>
                            <li><a href={staffPage && admin ? '#staff/courses' : '#courses'}>{staffPage && admin ? text.staffArea : text.courses}</a></li>
                            <li aria-current="page">{title}</li>
                        </ol>
                    </nav>
                )}
                <h1 id="page-title" tabIndex="-1">{title}</h1>
                {children}
            </main>
            <footer className="site-footer">
                <div className="content-width">{text.siteName}</div>
            </footer>
        </div>
    );
}

export default SiteLayout;
