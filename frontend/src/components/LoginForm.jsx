import { useEffect, useState } from 'react';

function LoginForm({ text, busy, feedback, notice, retryAt, onLogin }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [errors, setErrors] = useState({});
    const [now, setNow] = useState(Date.now);
    const throttled = now < retryAt;

    useEffect(function waitForRetry() {
        if (retryAt <= Date.now()) return;
        const interval = setInterval(function updateTime() {
            const time = Date.now();
            setNow(time);
            if (time >= retryAt) clearInterval(interval);
        }, 1000);
        return function stopWaiting() { clearInterval(interval); };
    }, [retryAt]);

    function handleSubmit(event) {
        event.preventDefault();
        if (busy || throttled) return;
        const invalid = {};
        if (!username.trim()) invalid.username = 'usernameRequired';
        else if (username.length > 50) invalid.username = 'usernameTooLong';
        if (!password) invalid.password = 'passwordRequired';
        else if (new TextEncoder().encode(password).length > 72) invalid.password = 'passwordTooLong';
        setErrors(invalid);
        const firstInvalid = Object.keys(invalid)[0];
        if (firstInvalid) {
            event.currentTarget.elements[firstInvalid].focus();
            return;
        }
        onLogin(username.trim(), password);
    }

    return (
        <form className="login-form" onSubmit={handleSubmit} noValidate aria-busy={busy}>
            <p className="form-introduction">{text.loginIntroduction}</p>
            {notice && <p className="feedback" role="status">{text[notice]}</p>}
            <div className="form-field">
                <label htmlFor="username">{text.username}</label>
                <input id="username" name="username" autoComplete="username" autoCapitalize="none"
                    spellCheck="false" required value={username} disabled={busy}
                    aria-invalid={Boolean(errors.username)}
                    aria-describedby={errors.username ? 'username-error' : undefined}
                    onChange={function changeUsername(event) { setUsername(event.target.value); }} />
                {errors.username && <p id="username-error" className="field-error">{text[errors.username]}</p>}
            </div>
            <div className="form-field">
                <label htmlFor="password">{text.password}</label>
                <input id="password" name="password" type="password" autoComplete="current-password"
                    required value={password} disabled={busy} aria-invalid={Boolean(errors.password)}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                    onChange={function changePassword(event) { setPassword(event.target.value); }} />
                {errors.password && <p id="password-error" className="field-error">{text[errors.password]}</p>}
            </div>
            {feedback && <p className="feedback error" role="alert">{text[feedback]}</p>}
            <button className="login-button" type="submit" disabled={busy || throttled}>
                {busy ? text.loggingIn : text.logIn}
            </button>
            {busy && <p className="visually-hidden" role="status">{text.loggingIn}</p>}
        </form>
    );
}

export default LoginForm;
