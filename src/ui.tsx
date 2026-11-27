import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { AudioLines, X } from 'lucide-react';

export function Brand({ onHome }: { onHome?: () => void }) {
  return <a href="/" className="wordmark" onClick={onHome ? (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onHome();
  } : undefined}>
    <span className="brand-mark"><AudioLines size={22} strokeWidth={1.75} aria-hidden="true" /></span>WorkEcho
  </a>;
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Skeleton({ label, kind = 'cards' }: { label: string; kind?: 'cards' | 'form' | 'workspace' }) {
  return <div className={'skeleton-panel skeleton-' + kind} role="status">
    <span className="sr-only">{label}</span>
    <div className="skeleton-shapes" aria-hidden="true"><span /><span /><span /><span /></div>
    {kind !== 'form' && <div className="skeleton-shapes" aria-hidden="true"><span /><span /><span /><span /></div>}
  </div>;
}

export function Dialog({ title, closeLabel, onClose, children }: {
  title: string; closeLabel: string; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  function dismiss() {
    dialog.current?.close();
    onClose();
  }
  return <dialog ref={dialog} className="action-dialog" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); dismiss(); }}
    onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
    <div className="dialog-inner">
      <div className="panel-heading"><h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label={closeLabel} onClick={dismiss} autoFocus><X size={20} aria-hidden="true" /></button>
      </div>
      {children}
    </div>
  </dialog>;
}

export function FieldLines() {
  const art = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = art.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    function draw() {
      if (!canvas || !ctx) return;
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * scale;
      canvas.height = height * scale;
      ctx.scale(scale, scale);
      ctx.lineWidth = 0.85;
      for (let band = 0; band < 35; band++) {
        ctx.beginPath();
        ctx.strokeStyle = band % 6 === 0 ? 'rgba(236, 174, 109, .78)' : 'rgba(197, 219, 172, .49)';
        for (let point = 0; point <= 180; point++) {
          const x = point / 180;
          const ridge = Math.exp(-Math.pow((x - .64) / .26, 2));
          const ripple = Math.sin(x * 10.8 + band * .087) * .13 + Math.cos(x * 17.5 - band * .07) * .035;
          const y = .38 + band * .014 + ripple * (.67 + ridge * 2.7) - x * .13;
          if (point) ctx.lineTo(x * width, y * height);
          else ctx.moveTo(x * width, y * height);
        }
        ctx.stroke();
      }
    }
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, []);
  return <canvas ref={art} className="field-lines" aria-hidden="true" />;
}
