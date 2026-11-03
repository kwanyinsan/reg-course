import { useCallback, useEffect, useState } from 'react';

export default function useNotification() {
    const [notice, setNotice] = useState(null);
    const notify = useCallback(function showNotice(key, tone = 'info') {
        setNotice({ key, tone });
    }, []);
    useEffect(function dismissNotice() {
        if (!notice) return;
        const timer = setTimeout(function dismiss() { setNotice(null); }, 5000);
        return function stopTimer() { clearTimeout(timer); };
    }, [notice]);
    return [notice, notify];
}
