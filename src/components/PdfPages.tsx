'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Renders every page of a PDF as a canvas (pdf.js, loaded on demand so it
// never ships in the main bundle). Each page is a position:relative box with
// the PDF's exact aspect ratio, so anything drawn in `renderPageOverlay`
// using fractional left/top/width/height lines up with the document no
// matter how wide the screen is. Used by both the TC's signature-spot
// placer and the signer's page.

const CANVAS_CSS_WIDTH = 1100; // internal render width in px; displayed at 100% of the container

interface PageSize {
  width: number;
  height: number;
}

interface PdfPagesProps {
  url: string;
  renderPageOverlay?: (pageIndex: number) => ReactNode;
  onLoaded?: (pageCount: number) => void;
  onError?: (message: string) => void;
}

function PageCanvas({
  pdf,
  pageIndex,
  size,
  overlay,
}: {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  size: PageSize;
  overlay: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(pageIndex < 2);

  // Only paint pages that are on (or near) the screen.
  useEffect(() => {
    if (visible) return;
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '800px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: CANVAS_CSS_WIDTH / base.width });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      task = page.render({ canvas, canvasContext: ctx, viewport });
      try {
        await task.promise;
      } catch {
        // Cancelled renders reject; nothing to do.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageIndex, visible]);

  return (
    <div
      ref={wrapRef}
      data-pdf-page={pageIndex}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${size.width} / ${size.height}`,
        background: '#fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
        marginBottom: 16,
        userSelect: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      <div style={{ position: 'absolute', inset: 0 }}>{overlay}</div>
    </div>
  );
}

export default function PdfPages({ url, renderPageOverlay, onLoaded, onError }: PdfPagesProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [failed, setFailed] = useState(false);

  // Keep the latest callbacks without re-loading the PDF when they change.
  const onLoadedRef = useRef(onLoaded);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString();
        const task = pdfjs.getDocument({ url });
        loadingTask = task;
        const doc = await task.promise;
        if (cancelled) {
          task.destroy();
          return;
        }
        const list: PageSize[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          list.push({ width: vp.width, height: vp.height });
        }
        if (cancelled) return;
        setSizes(list);
        setPdf(doc);
        onLoadedRef.current?.(doc.numPages);
      } catch (err) {
        console.error('Could not render PDF:', err);
        if (!cancelled) {
          setFailed(true);
          onErrorRef.current?.('Could not display this document');
        }
      }
    })();
    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [url]);

  if (failed) return null;
  if (!pdf) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Loading document…</div>;
  }

  return (
    <div>
      {sizes.map((size, i) => (
        <PageCanvas
          key={i}
          pdf={pdf}
          pageIndex={i}
          size={size}
          overlay={renderPageOverlay ? renderPageOverlay(i) : null}
        />
      ))}
    </div>
  );
}
