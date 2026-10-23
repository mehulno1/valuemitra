// Site visit: engineer link, office upload, the inspection sheet's fields, photo selection with
// checks (geo-tag, time stamps, selfie, duplicates), the property's location (photo GPS or a map
// screenshot found among the pictures) and the captions used in the report.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { PHOTO_MAX, PHOTO_MIN } from '@vm/shared';
import { Conf, FileDrop, FileImg, MessageBox, Panel, fmtDate, useErrorToast, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { caseKey, type TabProps } from './context';
import type { DocsResp, DocRow } from './DocumentsTab';
import type { FieldsResp } from './ExtractedTab';

interface Visit { id: number; status: string; expires_at: string; submitted_at: string | null; engineer_note: string | null; pin_lat: string | number | null; pin_lng: string | number | null; revoked_at: string | null }
interface Photo {
  id: number; file_id: number; thumb_file_id: number | null; source: string; taken_at: string | null; lat: string | number | null; lng: string | number | null;
  duplicate_of: number | null; is_selfie: number; names_visible: number; distance_m: number | null; ai_caption: string | null; caption: string | null; selected: number; sort_order: number; is_map: number;
}
interface Location { lat: unknown; lng: unknown; text: string | null; source: string | null; snippet: string | null; mapPhotos: number; mapPages: number }
interface SiteResp { visit: Visit | null; photos: Photo[]; location?: Location; minPhotos?: number; maxPhotos?: number }

const GEO_LIMIT_M = 40;
const BUSY = (d: DocRow) => d.status === 'uploaded' || d.status === 'reading';
const timeOf = (d: string) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const dayOf = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' });

export default function SiteTab({ c, go, refresh, locked }: TabProps) {
  const { can } = useAuth();
  const editable = can('edit') && !locked;
  const toast = useToast();
  const err = useErrorToast();
  const [msg, setMsg] = useState<{ url: string; expiresAt: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const site = useQuery({ queryKey: caseKey(c.id, 'site'), queryFn: () => api.get<SiteResp>(`/api/assignments/${c.id}/site`) });
  const docs = useQuery({
    queryKey: caseKey(c.id, 'documents'),
    queryFn: () => api.get<DocsResp>(`/api/assignments/${c.id}/documents`),
    refetchInterval: (q) => ((q.state.data as DocsResp | undefined)?.documents.some(BUSY) ? 3000 : false),
  });
  const fields = useQuery({ queryKey: caseKey(c.id, 'fields'), queryFn: () => api.get<FieldsResp>(`/api/assignments/${c.id}/fields`) });

  const sheets = (docs.data?.documents ?? []).filter((d) => d.role === 'site_sheet');
  const sheetBusy = sheets.some(BUSY);
  const wasBusy = useRef(sheetBusy);
  useEffect(() => {
    if (wasBusy.current && !sheetBusy) refresh();
    wasBusy.current = sheetBusy;
  }, [sheetBusy, refresh]);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast(ok); refresh(); return true; } catch (e) { err(e); return false; } finally { setBusy(null); }
  };

  if (site.isLoading) return <div className="muted p-4"><span className="dots">Loading site visit</span></div>;
  const visit = site.data?.visit ?? null;
  const photos = site.data?.photos ?? [];
  const siteFields = (fields.data?.sections ?? []).flatMap((s) => s.fields).filter((f) => f.source === 'site_sheet' && f.state === 'filled');
  const siteConflicts = (fields.data?.sections ?? []).flatMap((s) => s.fields).filter((f) => f.conflict && f.source === 'site_sheet');
  const hasData = photos.length > 0 || sheets.length > 0;
  const engineer = c.engineer_name ?? 'the field engineer';
  const linkLive = visit && !visit.revoked_at && visit.status !== 'submitted' && new Date(visit.expires_at) > new Date();

  const createLink = () => act('link', async () => setMsg(await api.post(`/api/assignments/${c.id}/site/link`)));
  const uploadPhotos = (files: File[]) => {
    const bad = files.filter((f) => !/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name));
    if (bad.length) { toast(`Photos only (JPEG or PNG): ${bad.map((f) => f.name).join(', ')}`, 'err'); return; }
    act('photos', () => api.upload(`/api/assignments/${c.id}/site/photos`, files), `${files.length} photo${files.length > 1 ? 's' : ''} uploaded. Checking for duplicates and captions…`);
  };
  const uploadSheet = (files: File[]) => act('sheet', () => api.upload(`/api/assignments/${c.id}/site/sheet`, files.slice(0, 1)), 'Inspection sheet received. Reading…');

  const linkPanel = (
    <div className="grid gap-3">
      {visit && (
        <div className="sub">
          {visit.status === 'submitted'
            ? `Visit submitted ${fmtDate(visit.submitted_at, true)}.`
            : linkLive
              ? `Visit link sent · ${visit.status === 'in_progress' ? 'engineer has started uploading' : 'not opened yet'} · valid till ${fmtDate(visit.expires_at, true)}.`
              : 'The last visit link has expired or was replaced.'}
          {visit.engineer_note && <> Note from engineer: “{visit.engineer_note}”</>}
        </div>
      )}
      {editable && (
        <div className="btns">
          <button className="btn pri" disabled={busy === 'link'} onClick={createLink}>{linkLive ? 'New visit link / Copy message' : 'Create visit link / Copy message'}</button>
        </div>
      )}
      {linkLive && <p className="sub">A new link replaces the earlier one.</p>}
      {msg && <MessageBox title="Visit link message" text={msg.message} onClose={() => setMsg(null)} />}
    </div>
  );

  const officeUpload = editable && (
    <div className="grid gap-3 sm:grid-cols-2">
      <FileDrop onFiles={uploadPhotos} accept="image/jpeg,image/png,image/webp" disabled={busy === 'photos'}>
        <b>Site photos</b>
        <p className="sub mt-1">Received another way? Drop the photos here. Time stamps and geo-tags are read from the photos.</p>
        {busy === 'photos' && <div className="muted mt-2"><span className="dots">Uploading</span></div>}
      </FileDrop>
      <FileDrop onFiles={uploadSheet} accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple={false} disabled={busy === 'sheet'}>
        <b>Inspection sheet</b>
        <p className="sub mt-1">One PDF or photo of the engineer's sheet. It is read into the site fields.</p>
        {busy === 'sheet' && <div className="muted mt-2"><span className="dots">Uploading</span></div>}
      </FileDrop>
    </div>
  );

  if (!hasData) {
    return (
      <div className="grid max-w-3xl gap-4">
        <section className="panel grid gap-3 px-6 py-6">
          <h2 className="text-lg">Waiting for {engineer}'s site visit</h2>
          <p className="muted text-[13.5px]">Send the engineer a visit link. They upload the inspection sheet and photos from their phone, no login needed. The draft report updates as soon as they submit.</p>
          {linkPanel}
        </section>
        {officeUpload && <Panel title="Upload from the office">{officeUpload}</Panel>}
        <p className="sub">Tip: bank documents and the site visit can arrive in any order; the draft takes whichever comes first.</p>
      </div>
    );
  }

  // ---- photo checks, computed from the data ----
  const dups = photos.filter((p) => p.duplicate_of);
  const fresh = photos.filter((p) => !p.duplicate_of && !p.is_map);
  const selected = photos.filter((p) => p.selected).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const geo = fresh.filter((p) => p.lat !== null && p.lng !== null);
  const far = geo.filter((p) => (p.distance_m ?? 0) > GEO_LIMIT_M);
  const untagged = fresh.length - geo.length;
  const times = fresh.filter((p) => p.taken_at).map((p) => p.taken_at as string).sort();
  const days = new Set(times.map(dayOf));
  const selfie = photos.some((p) => p.is_selfie);
  const names = photos.filter((p) => p.names_visible && p.selected);
  const checks: { ok: boolean | null; text: string }[] = [];
  if (fresh.length) {
    checks.push(
      !geo.length ? { ok: null, text: 'Location removed from the photos (usually because they came via WhatsApp)' }
        : far.length ? { ok: false, text: `${far.length} photo${far.length > 1 ? 's' : ''} more than ${GEO_LIMIT_M} m from the map pin` }
          : { ok: true, text: `${untagged ? `${geo.length} of ${fresh.length}` : 'All'} photos geo-tagged within ${GEO_LIMIT_M} m of the map pin` },
    );
    checks.push(
      !times.length ? { ok: false, text: 'No time stamps in the photos' }
        : days.size > 1 ? { ok: false, text: `Time stamps span ${days.size} days (${[...days].join(', ')})` }
          : { ok: true, text: `Time stamps ${timeOf(times[0])}–${timeOf(times[times.length - 1])} on ${dayOf(times[0])}` },
    );
    checks.push(selfie ? { ok: true, text: 'Selfie at site present' } : { ok: false, text: 'No selfie at site found' });
    checks.push({ ok: null, text: `${dups.length} duplicate${dups.length === 1 ? '' : 's'} left out` });
    if (names.length) checks.push({ ok: false, text: `${names.length} selected photo${names.length > 1 ? 's show' : ' shows'} residents' names` });
  }

  const togglePhoto = (p: Photo) => {
    if (!editable) return;
    const on = !p.selected;
    act(`ph${p.id}`, () => api.patch(`/api/assignments/${c.id}/site/photos/${p.id}`, { selected: on }));
  };
  const move = (idx: number, dir: -1 | 1) => {
    const ids = selected.map((p) => p.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    const rest = photos.filter((p) => !p.selected).map((p) => p.id);
    act('order', () => api.put(`/api/assignments/${c.id}/site/order`, { ids: [...ids, ...rest] }));
  };

  return (
    <div className="grid gap-4">
      <div className="split">
        <Panel title="Inspection sheet" right={visit?.status === 'submitted' ? <span className="chip c-review">Received</span> : <span className="chip c-site">Waiting</span>}>
          {!sheets.length && <p className="muted text-[13px]">No inspection sheet yet.</p>}
          {sheets.map((d) => (
            <div key={d.id} className="mb-2">
              <b className="break-words">{d.original_name}</b>
              <div className="sub">{[d.page_count ? `${d.page_count} page${d.page_count > 1 ? 's' : ''}` : null, d.channel, d.received_from ? `from ${d.received_from}` : null, fmtDate(d.received_at, true)].filter(Boolean).join(' · ')}</div>
              {BUSY(d) && <div className="mt-1 text-[13px]"><span className="dots">Reading the sheet</span></div>}
              {d.status === 'failed' && <div className="mt-2 rounded-md bg-crit-soft px-3 py-2 text-[13px] text-crit">{d.error || 'The sheet could not be read.'} Enter the site details on Extracted details.</div>}
            </div>
          ))}
          {siteFields.length > 0 && (
            <ul className="mt-2 grid">
              {siteFields.map((f) => (
                <li key={f.code} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] gap-3 border-b border-line py-2 text-[13px] last:border-0">
                  <span className="muted">{f.label}</span>
                  <span className="min-w-0 break-words">{f.display ?? String(f.value ?? '')}{f.page ? <span className="sub"> · p.{f.page}</span> : null}</span>
                  <Conf value={f.confidence} />
                </li>
              ))}
            </ul>
          )}
          {siteConflicts.map((f) => (
            <div key={f.code} className="flag"><div><b>Differs from documents: </b>{f.conflict!.message} Resolve it on <button className="linkbtn" onClick={() => go('ext')}>Extracted details</button> or <button className="linkbtn" onClick={() => go('chk')}>Checks</button>.</div></div>
          ))}
        </Panel>
        <Panel title="Visit link">{linkPanel}</Panel>
      </div>

      <Panel
        pad={false}
        title={<h3 className="text-[14px] font-semibold">Photos <span className="sub font-normal">· {photos.length} received · {selected.length} in the report (pick {site.data?.minPhotos ?? PHOTO_MIN}–{site.data?.maxPhotos ?? PHOTO_MAX})</span></h3>}
      >
        {checks.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line px-4 py-3 text-[13px]">
            {checks.map((k, i) => (
              <span key={i} className={k.ok === true ? 'text-ok' : k.ok === false ? 'text-warn' : 'muted'}>{k.ok === true ? '✓ ' : k.ok === false ? '! ' : ''}{k.text}</span>
            ))}
          </div>
        )}
        {!photos.length ? (
          <p className="muted p-4 text-[13px]">No photos yet.</p>
        ) : (
          <div className="photos">
            {photos.map((p) => {
              const badge = p.duplicate_of ? { cls: 'dup', t: 'dup' } : p.is_map ? { cls: 'mp', t: 'Map' } : p.names_visible ? { cls: 'nm', t: 'Names visible' } : p.is_selfie ? { cls: 'sf', t: 'Selfie' } : null;
              return (
                <button key={p.id} type="button" className={`ph ${p.selected ? 'sel' : ''}`} onClick={() => togglePhoto(p)} disabled={!editable || busy === `ph${p.id}`} aria-pressed={!!p.selected}>
                  <FileImg id={p.thumb_file_id ?? p.file_id} alt={p.caption ?? p.ai_caption ?? 'Site photo'} />
                  {badge && <span className={`bd ${badge.cls}`}>{badge.t}</span>}
                  <span className="ck">{p.selected ? '✓' : ''}</span>
                  <div className="cap">
                    {p.caption ?? p.ai_caption ?? <span className="muted">No caption</span>}
                    <small>{p.is_map ? 'Prints on the location map page' : !p.taken_at && p.lat === null ? 'Location removed (came via WhatsApp)' : [p.taken_at ? timeOf(p.taken_at) : 'no time', p.distance_m !== null ? `${p.distance_m} m` : p.lat !== null ? `${Number(p.lat).toFixed(4)}N ${Number(p.lng).toFixed(4)}E` : 'no location'].join(' · ')}</small>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      {hasData && site.data?.location && <LocationPanel c={c} loc={site.data.location} editable={editable} refresh={refresh} />}

      {selected.length > 0 && (
        <Panel title="Captions in the report" right={<span className="sub">Suggested from what each photo shows</span>} pad={false}>
          <ol>
            {selected.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
                <span className="mono w-6 text-right text-[12px] muted">{i + 1}</span>
                <FileImg id={p.thumb_file_id ?? p.file_id} className="h-12 w-9 flex-none rounded object-cover" style={{ aspectRatio: 'auto' }} />
                <input
                  className="inp min-w-0 flex-1"
                  defaultValue={p.caption ?? p.ai_caption ?? ''}
                  key={`${p.id}-${p.caption ?? ''}`}
                  maxLength={200}
                  disabled={!editable}
                  aria-label={`Caption for photo ${i + 1}`}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v === (p.caption ?? p.ai_caption ?? '').trim()) return;
                    act(`cap${p.id}`, () => api.patch(`/api/assignments/${c.id}/site/photos/${p.id}`, { caption: v }), 'Caption saved.');
                  }}
                />
                {editable && (
                  <span className="flex flex-none gap-1">
                    <button className="btn sm ghost" disabled={i === 0 || busy === 'order'} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                    <button className="btn sm ghost" disabled={i === selected.length - 1 || busy === 'order'} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {officeUpload && <Panel title="Upload more from the office">{officeUpload}</Panel>}
    </div>
  );
}

/** Where the property is: read from photo GPS or a map screenshot, or typed in. Prints on the location map page. */
function LocationPanel({ c, loc, editable, refresh }: { c: TabProps['c']; loc: Location; editable: boolean; refresh: () => void }) {
  const toast = useToast();
  const err = useErrorToast();
  const has = loc.lat !== null && loc.lat !== undefined && loc.lat !== '' && loc.lng !== null && loc.lng !== undefined && loc.lng !== '';
  const [val, setVal] = useState(has ? `${loc.lat}, ${loc.lng}` : '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setVal(has ? `${loc.lat}, ${loc.lng}` : ''); }, [loc.lat, loc.lng, has]);
  const from = loc.source === 'manual' ? 'entered by hand' : loc.source === 'site_sheet' ? (loc.snippet ?? 'from the photos\' GPS') : loc.source === 'evidence' ? (loc.snippet ?? 'read from a map screenshot') : loc.source === 'document' ? 'from the documents' : '';
  const save = async () => {
    const m = val.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (!m || Math.abs(Number(m[1])) > 90 || Math.abs(Number(m[2])) > 180) return toast('Enter latitude and longitude, for example 19.2136, 72.9785', 'err');
    setSaving(true);
    try {
      await api.put(`/api/assignments/${c.id}/fields/PROP.LAT`, { value: m[1], reason: 'Location corrected on the Site visit tab' });
      await api.put(`/api/assignments/${c.id}/fields/PROP.LNG`, { value: m[2], reason: 'Location corrected on the Site visit tab' });
      toast('Location saved. The map page uses it.');
      refresh();
    } catch (e) { err(e); } finally { setSaving(false); }
  };
  const maps = loc.mapPhotos + loc.mapPages;
  return (
    <Panel title="Location" right={<span className="sub">Every picture is scanned for a map screenshot</span>}>
      <div className="grid gap-3">
        {has ? (
          <div className="flag ok"><div>✓ <b>Location found</b>{loc.text ? `: ${loc.text}` : ''}{from ? ` · ${from}` : ''}.{maps ? ` ${maps} map screenshot${maps > 1 ? 's' : ''} print${maps > 1 ? '' : 's'} on the location map page.` : ''}</div></div>
        ) : (
          <div className="flag"><div><b>No location found.</b> {maps ? `A map screenshot was found but its coordinates could not be read. ` : 'No map screenshot among the pictures, and the photos carry no GPS. '}Ask {c.engineer_name ?? 'the engineer'} for a Google Maps screenshot of the site, or enter the coordinates below.</div></div>
        )}
        <div className="field" style={{ maxWidth: 360 }}>
          <label>Coordinates (edit if needed)</label>
          <div className="flex gap-2">
            <input className="mono min-w-0 flex-1" value={val} disabled={!editable} onChange={(e) => setVal(e.target.value)} placeholder="19.2136, 72.9785" onKeyDown={(e) => e.key === 'Enter' && save()} />
            {editable && <button className="btn" disabled={saving || val.trim() === (has ? `${loc.lat}, ${loc.lng}` : '')} onClick={save}>{saving ? <span className="dots">Saving</span> : 'Save'}</button>}
          </div>
        </div>
      </div>
    </Panel>
  );
}
