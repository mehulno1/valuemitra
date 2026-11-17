// Open a whole document (13 Nov re-test B1): every page of the document in a pop-up viewer, scrolled to the source
// page, from the Documents tab and from every "Show source" on Extracted details. "Open original file" opens the
// file as uploaded in a new tab. KYC pages are never shown (their stored copy is redacted).
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, fileUrl } from '@/lib/api';
import { FileImg, Modal } from '@/components/ui';

interface Thumb { page: number; thumb: number | null; image: number | null }
interface Part { id: number; title: string | null; type_label: string; pages: number[]; is_kyc: boolean; thumbs: Thumb[] }
interface Doc { id: number; original_name: string | null; file_id: number; mime: string | null; parts: Part[] }

export function OpenDoc({ assignmentId, partId, documentId, page, label = 'Open', className = 'linkbtn' }: { assignmentId: number; partId?: number | null; documentId?: number | null; page?: number | null; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!partId && !documentId) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      {open && <Viewer assignmentId={assignmentId} partId={partId ?? null} documentId={documentId ?? null} page={page ?? null} onClose={() => setOpen(false)} />}
    </>
  );
}

function Viewer({ assignmentId, partId, documentId, page, onClose }: { assignmentId: number; partId: number | null; documentId: number | null; page: number | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['case', assignmentId, 'documents'], queryFn: () => api.get<{ documents: Doc[] }>(`/api/assignments/${assignmentId}/documents`) });
  const docs = q.data?.documents ?? [];
  const doc = docs.find((d) => (partId ? d.parts.some((p) => p.id === partId) : d.id === documentId));
  const part = partId ? doc?.parts.find((p) => p.id === partId) : null;
  // the document as sorted (its pages), or the whole upload; never KYC pages
  const pages = (part ? part.thumbs : (doc?.parts ?? []).filter((p) => !p.is_kyc).flatMap((p) => p.thumbs)).slice().sort((a, b) => a.page - b.page);
  const refs = useRef(new Map<number, HTMLDivElement>());
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (!page || !pages.length) return;
    const el = refs.current.get(page) ?? refs.current.get(pages[Math.min(pages.length, Math.max(1, page)) - 1]?.page);
    el?.scrollIntoView({ block: 'start' });
  }, [page, pages.length]);
  const title = part ? (part.title || part.type_label) : doc?.original_name ?? 'Document';
  const openOriginal = async () => { if (doc) window.open(await fileUrl(doc.file_id), '_blank', 'noopener'); };
  return (
    <Modal open wide onClose={onClose} title={title} actions={<>
      <span className="sub mr-auto">{pages.length} page{pages.length === 1 ? '' : 's'}{page ? ` · source on p. ${page}` : ''}</span>
      <button className="btn sm ghost" onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))} aria-label="Zoom out">−</button>
      <button className="btn sm ghost" onClick={() => setZoom((z) => Math.min(2.4, z + 0.2))} aria-label="Zoom in">+</button>
      {doc && <button className="btn sm" onClick={openOriginal}>Open original file</button>}
      <button className="btn sm pri" onClick={onClose}>Close</button>
    </>}>
      {q.isLoading ? <p className="sub">Loading…</p> : !pages.length ? <p className="sub">No pages to show.</p> : (
        <div className="max-h-[72vh] overflow-auto rounded-md bg-sunk p-2">
          {pages.map((t) => (
            <div key={t.page} ref={(el) => { if (el) refs.current.set(t.page, el); }} className={`mx-auto mb-3 ${t.page === page ? 'outline outline-2 outline-stamp' : ''}`} style={{ width: `${Math.round(100 * zoom)}%`, maxWidth: zoom > 1 ? 'none' : '100%' }}>
              <div className="sub mb-1">Page {t.page}{t.page === page ? ' · source' : ''}</div>
              <FileImg id={t.image ?? t.thumb} alt={`Page ${t.page}`} className="block w-full bg-white" />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
