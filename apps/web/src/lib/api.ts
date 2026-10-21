// API client: access token in memory, refresh token in an httpOnly cookie. A 401 triggers one
// refresh attempt, then the caller sees the error and the app returns to sign-in.

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export const setAccessToken = (t: string | null) => { accessToken = t; };
export const onSignedOut = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

async function refresh(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) return false;
      const j = await r.json();
      accessToken = j.accessToken;
      sessionCache = j;
      return true;
    })
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export let sessionCache: any = null;
export const tryRestore = async () => ((await refresh()) ? sessionCache : null);

async function request<T>(method: string, url: string, body?: unknown, raw = false, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(url, { method, headers, body: payload, credentials: 'include' });
  if (r.status === 401 && retry && !url.startsWith('/api/auth/')) {
    if (await refresh()) return request<T>(method, url, body, raw, false);
    listeners.forEach((f) => f());
  }
  if (!r.ok) {
    let j: any = {};
    try { j = await r.json(); } catch { /* not json */ }
    throw new ApiError(r.status, j.error ?? 'ERROR', j.message ?? `Request failed (${r.status})`, j.details);
  }
  if (raw) return (await r.arrayBuffer()) as T;
  const ct = r.headers.get('content-type') ?? '';
  return (ct.includes('json') ? r.json() : r.text()) as Promise<T>;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T = any>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  upload: <T = any>(url: string, files: File[] | FileList, fields: Record<string, string> = {}, fileField = 'file') => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    Array.from(files).forEach((f) => fd.append(fileField, f, f.name));
    return request<T>('POST', url, fd);
  },
  binary: (url: string) => request<ArrayBuffer>('GET', url, undefined, true),
};

/** URL for an authenticated file (images are fetched as blobs because the token is not a cookie). */
const blobCache = new Map<number, string>();
export async function fileUrl(id: number): Promise<string> {
  const hit = blobCache.get(id);
  if (hit) return hit;
  const buf = await api.binary(`/api/files/${id}`);
  const url = URL.createObjectURL(new Blob([buf]));
  blobCache.set(id, url);
  return url;
}

export async function downloadFile(id: number, name: string) {
  const buf = await api.binary(`/api/files/${id}?download=1`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Download an authenticated endpoint as a file (exports, invoice PDFs). */
export async function downloadUrl(url: string, name: string) {
  const buf = await api.binary(url);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf]));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Save text as a CSV file (BOM so Excel reads UTF-8). */
export function saveCsv(name: string, head: string[], rows: unknown[][]) {
  const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** WhatsApp link for an Indian mobile number (10 digits get the 91 prefix). */
export function whatsappUrl(phone: string | null | undefined, text: string) {
  const d = (phone ?? '').replace(/\D/g, '');
  const n = d.length === 10 ? `91${d}` : d.replace(/^0+/, '');
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
