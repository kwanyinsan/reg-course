function SiteLayout({ text, language, onLanguageChange, page, admin, title, children }) {
    const languages = [
        { code: 'en', label: 'English' },
        { code: 'zh-Hant', label: '繁體' },
        { code: 'zh-Hans', label: '简体' },
    ];

    return (
        <div className="site-layout">
            <a className="skip-link" href="#main-content" onClick={function skipToContent(event) {
                event.preventDefault();
                document.getElementById('main-content').focus();
            }}>{text.skipToContent}</a>
            <header className="site-header">
                <div className="header-content content-width">
                    <a className="site-name" href="#home">{text.siteName}</a>
                    <div className="language-controls" role="group" aria-label={text.language}>
                        {languages.map(function languageButton(item) {
                            return (
                                <button type="button" key={item.code} lang={item.code}
                                    aria-pressed={language === item.code}
                                    onClick={function chooseLanguage() { onLanguageChange(item.code); }}>
                                    {item.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <nav className="site-navigation content-width" aria-label={text.mainNavigation}>
                    <a href="#home" aria-current={page === 'home' ? 'page' : undefined}>{text.home}</a>
                    <a href="#staff" aria-current={page === 'staff' ? 'page' : undefined}>
                        {admin ? text.staffArea : text.staffLogin}
                    </a>
                </nav>
            </header>
            <main id="main-content" className="main-content content-width" tabIndex="-1">
                <h1 id="page-title">{title}</h1>
                {children}
            </main>
            <footer className="site-footer">
                <div className="content-width">{text.prototype}</div>
            </footer>
        </div>
    );
}

export default SiteLayout;
