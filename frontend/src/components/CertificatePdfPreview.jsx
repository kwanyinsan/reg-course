import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

function CertificatePdfPreview({ url, text }) {
    const container = useRef(null);
    const canvas = useRef(null);
    const [status, setStatus] = useState('loading');

    useEffect(function renderPdf() {
        let closed = false;
        let page;
        let render;
        let width = 0;
        let version = 0;
        const loading = getDocument({ url, isEvalSupported: false, enableXfa: false });

        async function draw() {
            if (!page || closed) return;
            const nextWidth = Math.max(1, container.current.clientWidth);
            if (nextWidth === width) return;
            width = nextWidth;
            const current = ++version;
            if (render) {
                render.cancel();
                await render.promise.catch(function cancelled() {});
            }
            if (closed || current !== version) return;
            try {
                const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
                const pixels = Math.min(window.devicePixelRatio || 1, 2);
                canvas.current.width = Math.ceil(viewport.width * pixels);
                canvas.current.height = Math.ceil(viewport.height * pixels);
                render = page.render({ canvasContext: canvas.current.getContext('2d'), viewport,
                    transform: [pixels, 0, 0, pixels, 0, 0] });
                await render.promise;
                if (!closed && current === version) setStatus('ready');
            } catch (error) {
                if (!closed && current === version && error.name !== 'RenderingCancelledException') setStatus('error');
            }
        }
        const observer = new ResizeObserver(draw);
        observer.observe(container.current);
        loading.promise.then(async function loaded(pdf) {
            if (closed) return;
            if (pdf.numPages !== 1) throw new Error('Expected one certificate page.');
            page = await pdf.getPage(1);
            await draw();
        }).catch(function failed() { if (!closed) setStatus('error'); });
        return function dispose() {
            closed = true;
            ++version;
            observer.disconnect();
            render?.cancel();
            loading.destroy().catch(function destroyed() {});
        };
    }, [url]);

    return <div className="certificate-pdf" ref={container}>
        <p className={status === 'ready' ? 'visually-hidden' : ''} role="status">{status === 'ready' ? text.certificatePreviewReady
            : status === 'error' ? text.certificatePreviewError : text.certificatePreviewLoading}</p>
        <canvas ref={canvas} role="img" aria-label={text.certificatePreview} hidden={status !== 'ready'} />
    </div>;
}

export default CertificatePdfPreview;
