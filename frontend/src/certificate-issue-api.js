export async function certificateRequest(path, method = 'GET', body) {
    const response = await fetch(`/api/admin/${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'reg-course' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error('Certificate request failed.'), { status: response.status, code: data.code, reasons: data.reasons });
    return data;
}
