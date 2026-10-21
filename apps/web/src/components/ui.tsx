// Shared UI pieces. Keep screens consistent: use these instead of ad-hoc markup.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { confClass, inr, stageLabel } from '@vm/shared';
import { ApiError, fileUrl } from '@/lib/api';

// ---- toast ------------------------------------------------------------------------------------
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const timer = useRef<number>();
  const show = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setT({ msg, kind });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setT(null), kind === 'err' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={`toast ${t.kind === 'err' ? 'err' : ''}`} role="status">{t.msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Show an API error as a toast. */
export function useErrorToast() {
  const toast = useToast();
  return useCallback((e: unknown) => toast(e instanceof ApiError || e instanceof Error ? e.message : String(e), 'err'), [toast]);
}

// ---- small pieces -------------------------------------------------------------------------------
export function StageChip({ stage }: { stage: string }) {
  return <span className={`chip c-${stage}`}>{stageLabel(stage)}</span>;
}

export function Conf({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="conf x">rule</span>;
  return <span className={`conf ${confClass(value)}`} title="Reading confidence">{Math.round(value)}%</span>;
}

export const Pending = ({ label }: { label?: string | null }) => <span className="pendv">{label ?? 'Pending'}</span>;

export function Money({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  return <span className="mono">Rs. {inr(value)}</span>;
}

export function PageHead({ eyebrow, title, actions }: { eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="topline">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
      </div>
      {actions && <div className="btns">{actions}</div>}
    </div>
  );
}

export function Panel({ title, right, children, className = '', pad = true }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {typeof title === 'string' ? <h3 className="text-[14px] font-semibold">{title}</h3> : title}
          {right}
        </div>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel grid max-w-2xl gap-2 px-7 py-8">
      <h2 className="text-lg">{title}</h2>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <div className="muted p-4"><span className="dots">{what}</span></div>;
}

/** Copy-ready message (WhatsApp / email drafts) with Copy and Close. */
export function MessageBox({ title, text, subject, onClose }: { title: string; text: string; subject?: string | null; onClose?: () => void }) {
  const toast = useToast();
  return (
    <div className="panel msgbox">
      <div className="flex items-center justify-between gap-2"><b>{title}</b>{onClose && <button className="btn ghost sm" onClick={onClose}>Close</button>}</div>
      {subject && <div className="sub">Subject: {subject}</div>}
      <pre>{text}</pre>
      <div className="btns">
        <button className="btn sm" onClick={() => navigator.clipboard.writeText(subject ? `${subject}\n\n${text}` : text).then(() => toast('Copied'))}>Copy</button>
        {/^[\s\S]*$/.test(text) && <a className="btn sm ghost" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Open in WhatsApp</a>}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2 className="text-lg">{title}</h2>
        {children}
        {actions && <div className="btns justify-end">{actions}</div>}
      </div>
    </div>
  );
}

/** Image from an authenticated file id. */
export function FileImg({ id, alt = '', className = '', style }: { id: number | null | undefined; alt?: string; className?: string; style?: React.CSSProperties }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    if (id) fileUrl(id).then((u) => live && setSrc(u)).catch(() => undefined);
    return () => { live = false; };
  }, [id]);
  if (!id) return null;
  return src ? <img src={src} alt={alt} className={className} style={style} loading="lazy" /> : <div className={`bg-sunk ${className}`} style={{ aspectRatio: '3/4', ...style }} />;
}

/** Drag-and-drop or pick files. */
export function FileDrop({ onFiles, accept, multiple = true, children, disabled }: { onFiles: (f: File[]) => void; accept?: string; multiple?: boolean; children?: ReactNode; disabled?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`drop ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files)); }}
    >
      {children}
      <div className="btns mt-3 justify-center">
        <button className="btn" type="button" disabled={disabled} onClick={() => input.current?.click()}>Choose files</button>
      </div>
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { if (e.target.files?.length) onFiles(Array.from(e.target.files)); e.target.value = ''; }} />
    </div>
  );
}

export function Field({ label, hint, children, full }: { label: string; hint?: ReactNode; children: ReactNode; full?: boolean }) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export const fmtDate = (d: string | Date | null | undefined, time = false) => {
  if (!d) return '';
  const x = new Date(d);
  return x.toLocaleString('en-IN', time ? { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' } : { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

export const ago = (d: string | Date | null | undefined) => {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(d);
};
