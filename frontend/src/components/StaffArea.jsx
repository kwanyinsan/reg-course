function StaffArea({ text, admin, busy, feedback, onLogout }) {
    return (
        <section className="staff-area" aria-busy={busy}>
            <p>{text.signedInAs} <strong className="admin-name">{admin.username}</strong></p>
            {feedback && <p className="feedback error" role="alert">{text[feedback]}</p>}
            <button type="button" disabled={busy} onClick={onLogout}>
                {busy ? text.loggingOut : text.logOut}
            </button>
            {busy && <p className="visually-hidden" role="status">{text.loggingOut}</p>}
        </section>
    );
}

export default StaffArea;
