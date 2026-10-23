// Public, no-login page for the field engineer's visit link. Mobile first: big touch targets,
// camera capture, upload progress. Uses plain fetch (no app session, no token refresh).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

interface Visit {
  caseNo: string; firm: string; bank: string; branch: string; engineer: string | null; address: string | null;
  status: string; expiresAt: string; prompts: string[]; minPhotos: number; photos: number; sheetUploaded: boolean; covered?: number[]; reading?: boolean;
  photoIds: number[]; newSinceSubmit: number;
}

async function readError(r: Response) {
  try { const j = await r.json(); return j.message ?? `Request failed (${r.status})`; } catch { return `Request failed (${r.status})`; }
}

/** XHR upload so we can show progress. */
function upload(url: string, files: File[], kind: 'sheet' | 'photos', onProgress: (p: number) => void) {
  return new Promise<any>((resolve, reject) => {
    const fd = new FormData();
    fd.append('kind', kind);
    files.forEach((f) => fd.append('file', f, f.name));
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      let j: any = {};
      try { j = JSON.parse(x.responseText); } catch { /* not json */ }
      if (x.status >= 200 && x.status < 300) resolve(j);
      else reject(new Error(j.message ?? `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new Error('Network problem. Check your connection and try again.'));
    x.send(fd);
  });
}

const big = { minHeight: 52, fontSize: 16, justifyContent: 'center', width: '100%' } as const;

export default function EngineerVisit() {
  const { token = '' } = useParams();
  const base = `/api/public/visit/${encodeURIComponent(token)}`;
  const [v, setV] = useState<Visit | null>(null);
  const [err, setErr] = useState<{ status: number; msg: string } | null>(null);
  const [busy, setBusy] = useState<null | 'sheet' | 'photos' | 'submit'>(null);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const sheetIn = useRef<HTMLInputElement>(null);
  const camIn = useRef<HTMLInputElement>(null);
  const galIn = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(base);
      if (!r.ok) { setErr({ status: r.status, msg: await readError(r) }); return; }
      setV(await r.json());
      setErr(null);
    } catch {
      setErr({ status: 0, msg: 'Could not reach the server. Check your connection and reload.' });
    }
  }, [base]);
  useEffect(() => { load(); }, [load]);
  // photos are being read: check again shortly so the checklist ticks itself
  useEffect(() => {
    if (!v?.reading) return;
    const t = setTimeout(load, 5000);
    return () => clearTimeout(t);
  }, [v, load]);

  const send = async (kind: 'sheet' | 'photos', files: File[]) => {
    if (!files.length) return;
    setBusy(kind); setProgress(0); setNotice(null);
    try {
      const r = await upload(`${base}/upload`, files, kind, setProgress);
      setNotice({ ok: true, msg: kind === 'sheet' ? 'Inspection sheet uploaded.' : `${r.photos ?? files.length} photo${files.length === 1 ? '' : 's'} uploaded.` });
      await load();
    } catch (e) {
      setNotice({ ok: false, msg: (e as Error).message });
    } finally { setBusy(null); }
  };

  const submit = async () => {
    setBusy('submit'); setNotice(null);
    try {
      const r = await fetch(`${base}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: note.trim() || null }) });
      if (!r.ok) throw new Error(await readError(r));
      await load();
      setNotice({ ok: true, msg: 'Sent to the office. Thank you. Nothing more is needed unless you missed a photo.' });
    } catch (e) {
      setNotice({ ok: false, msg: (e as Error).message });
    } finally { setBusy(null); }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-full" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto grid max-w-[560px] gap-4 px-4 pb-16 pt-5">
        <div className="brand"><div className="seal">VM</div><div><b>ValueMitra</b><small>Site visit</small></div></div>
        {children}
      </div>
    </div>
  );

  if (err) {
    const expired = /expired/i.test(err.msg);
    return shell(
      <div className="panel grid gap-2 p-5">
        <h1 className="text-xl">{expired ? 'This link has expired' : err.status === 404 ? 'This link is not valid' : 'Something went wrong'}</h1>
        <p className="muted m-0">{expired ? 'Ask the office to send you a new site visit link.' : err.status === 404 ? 'It may have been replaced by a newer link. Ask the office to send the latest one.' : err.msg}</p>
        {err.status === 0 && <button className="btn" style={big} onClick={load}>Try again</button>}
      </div>,
    );
  }
  if (!v) return shell(<div className="muted p-4"><span className="dots">Loading</span></div>);

  const submitted = v.status === 'submitted';
  const pendingSend = !submitted || v.newSinceSubmit > 0;
  const enough = v.photos >= v.minPhotos;
  const expires = new Date(v.expiresAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

  return shell(
    <>
      <div className="panel grid gap-1 p-4">
        <div className="eyebrow">{v.firm}</div>
        <h1 className="text-[22px]">Site visit · <span className="mono">{v.caseNo}</span></h1>
        <div className="text-[15px]">{v.bank} · {v.branch}</div>
        {v.address && <div className="text-[15px] font-semibold">{v.address}</div>}
        <div className="sub">{v.engineer ? `For ${v.engineer} · ` : ''}Link valid till {expires}</div>
      </div>

      {submitted && (
        <div className="panel grid gap-1 p-4" style={{ borderLeft: '4px solid var(--ok)' }}>
          <b className="text-ok">Visit submitted</b>
          <span className="sub">The office has your sheet and photos. You can still add photos you missed; they go to the same case. Do not upload the same photos again.</span>
        </div>
      )}

      {notice && (
        <div role="status" className="panel p-3 text-[15px]" style={{ borderLeft: `4px solid var(--${notice.ok ? 'ok' : 'crit'})`, color: notice.ok ? undefined : 'var(--crit)' }}>{notice.msg}</div>
      )}

      {busy && busy !== 'submit' && (
        <div className="panel grid gap-2 p-4">
          <b>Uploading {busy === 'sheet' ? 'inspection sheet' : 'photos'}… {progress}%</b>
          <div className="bar" style={{ width: '100%', height: 8 }}><i style={{ width: `${progress}%` }} /></div>
          <span className="sub">Keep this page open until it finishes.</span>
        </div>
      )}

      <section className="panel grid gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[17px]">1. Inspection sheet</h2>
          {v.sheetUploaded ? <span className="sev ok">Received</span> : <span className="sev warn">Needed</span>}
        </div>
        <p className="sub m-0">Upload the filled inspection sheet: a PDF, or a clear photo of each page.</p>
        <button className="btn pri" style={big} disabled={!!busy} onClick={() => sheetIn.current?.click()}>{v.sheetUploaded ? 'Upload sheet again' : 'Upload inspection sheet'}</button>
        <input ref={sheetIn} type="file" hidden accept="application/pdf,image/*" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; send('sheet', f.slice(0, 1)); }} />
      </section>

      <section className="panel grid gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[17px]">2. Photos</h2>
          <span className={`sev ${enough ? 'ok' : 'warn'}`}>{v.photos} / {v.minPhotos}+</span>
        </div>
        <p className="sub m-0">Take at least {v.minPhotos} photos. Keep location on so photos are geo-tagged. Upload as many as you like; the office picks the best.</p>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn pri" style={big} disabled={!!busy} onClick={() => camIn.current?.click()}>Take photos</button>
          <button className="btn" style={big} disabled={!!busy} onClick={() => galIn.current?.click()}>Choose from gallery</button>
        </div>
        <input ref={camIn} type="file" hidden accept="image/*" capture="environment" multiple onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; send('photos', f); }} />
        <input ref={galIn} type="file" hidden accept="image/*" multiple onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; send('photos', f); }} />
        {!!v.photoIds.length && (
          <div className="grid gap-1.5">
            <div className="eyebrow mt-1">Received by the office ({v.photoIds.length})</div>
            <div className="grid grid-cols-4 gap-1.5">
              {v.photoIds.map((id) => (
                <img key={id} src={`${base}/photo/${id}`} alt="" loading="lazy" className="aspect-square w-full rounded-md border border-line object-cover" />
              ))}
            </div>
          </div>
        )}
        {!!v.prompts.length && (
          <div className="grid gap-1">
            <div className="eyebrow mt-1">Photo checklist</div>
            {v.prompts.map((p, i) => {
              const found = !!v.covered?.includes(i);
              const on = checked[i] ?? found;
              return (
                <label key={i} className="flex cursor-pointer items-center gap-3 rounded-md px-1 text-[15px]" style={{ minHeight: 44 }}>
                  <input type="checkbox" className="h-5 w-5" checked={on} onChange={(e) => setChecked((c) => ({ ...c, [i]: e.target.checked }))} />
                  <span style={{ textDecoration: on ? 'line-through' : undefined, color: on ? 'var(--muted)' : undefined }}>{p}</span>
                  {found && <span className="sub ml-auto text-[12px]">in your photos</span>}
                </label>
              );
            })}
            <span className="sub">{v.reading ? 'Reading your photos… items they show tick themselves.' : 'Items your photos show tick themselves. Tick the rest as you go; this list is only a reminder.'}</span>
          </div>
        )}
      </section>

      <section className="panel grid gap-3 p-4">
        <h2 className="text-[17px]">3. Send to office</h2>
        <div className="field">
          <label htmlFor="note">Note for the office (optional)</label>
          <textarea id="note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Owner's relative met on site; lift not working" style={{ fontSize: 16 }} />
        </div>
        {!enough && !submitted && <div className="sub" style={{ color: 'var(--warn)' }}>Only {v.photos} photo{v.photos === 1 ? '' : 's'} so far; {v.minPhotos} or more are needed for the report.</div>}
        <button className="btn pri" style={big} disabled={!!busy || (!v.photos && !v.sheetUploaded) || !pendingSend} onClick={submit}>
          {busy === 'submit' ? 'Sending…' : !submitted ? 'Submit visit' : v.newSinceSubmit ? `Send ${v.newSinceSubmit} new upload${v.newSinceSubmit === 1 ? '' : 's'} to the office` : 'Submitted ✓'}
        </button>
      </section>
    </>,
  );
}
