function Notification({ notice, text }) {
    return <div className="notifications" role="status" aria-live="polite" aria-atomic="true">
        {notice && <div className={`notification-toast ${notice.tone}`}>{text[notice.key]}</div>}
    </div>;
}

export default Notification;
