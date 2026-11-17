// A Word file shown page by page in the browser (docx-preview), scaled to fit narrow screens. Used by Bank formats
// → Preview with a case (H1); the case's Report & sign-off tab has its own click-to-edit version.
import { renderAsync } from 'docx-preview';
import { useCallback, useEffect, useRef, useState } from 'react';

export function DocxPages({ buf }: { buf: ArrayBuffer | null }) {
  const host = useRef<HTMLDivElement>(null);
  const desk = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const fit = useCallback(() => {
    const h = host.current, d = desk.current;
    const page = h?.querySelector<HTMLElement>('section.docx');
    if (!h || !d || !page) return;
    const avail = d.clientWidth - 32;
    (h.style as any).zoom = page.offsetWidth > avail && avail > 0 ? String(Math.max(0.35, avail / page.offsetWidth)) : '';
  }, []);
  useEffect(() => {
    const d = desk.current;
    if (!d || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(d);
    return () => ro.disconnect();
  }, [fit]);
  useEffect(() => {
    let live = true;
    if (!buf || !host.current) return;
    setErr(null);
    const tmp = document.createElement('div');
    renderAsync(buf.slice(0), tmp, undefined, { inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, experimental: true })
      .then(() => { if (live && host.current) { host.current.replaceChildren(...Array.from(tmp.childNodes)); requestAnimationFrame(fit); } })
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [buf, fit]);
  return (
    <div className="desk" ref={desk}>
      {err && <p className="sub m-0">The pages could not be shown here ({err}). Download the .docx or PDF instead.</p>}
      <div ref={host} />
    </div>
  );
}
