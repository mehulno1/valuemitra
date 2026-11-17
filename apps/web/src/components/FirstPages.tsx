// The first two pages of a format filled with a case, as small pictures: letterhead, cover and page 2 at a glance
// (Report layout, 6 Nov mock). `layout` shows choices not saved yet.
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useErrorToast } from '@/components/ui';

export function FirstPages({ versionId, layout, label = 'Show the first pages' }: { versionId: number; layout?: Record<string, unknown> | null; label?: string }) {
  const onErr = useErrorToast();
  const run = useMutation({
    mutationFn: () => api.get<{ pages: string[] }>(`/api/templates/versions/${versionId}/first-pages${layout ? `?layout=${encodeURIComponent(JSON.stringify(layout))}` : ''}`),
    onError: onErr,
  });
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn sm" disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? <span className="dots">Preparing (about 10 seconds)</span> : run.data ? 'Show again' : label}</button>
        {run.data && <span className="sub">Filled with your latest case on this format</span>}
      </div>
      {run.data && (
        <div className="flex flex-wrap gap-3">
          {run.data.pages.map((src, i) => (
            <figure key={i} className="m-0 grid gap-1">
              <img src={src} alt={`Page ${i + 1}`} style={{ width: 170, border: '1px solid var(--line)', borderRadius: 4, background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.12)' }} />
              <figcaption className="sub text-center">Page {i + 1}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
