import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { OCRStatus, DocumentType } from '@valuemitra/shared';

const DOCUMENTS_KEY = 'documents';

export interface Document {
  id: string;
  assignmentId: string;
  documentType: DocumentType;
  originalName: string;
  fileSizeBytes: number;
  mimeType: string;
  ocrStatus: OCRStatus;
  storagePath: string;
  storageProvider: string;
  createdAt: string;
  signedUrl?: string;
  photoCategory?: string | null;
}

export function useDocuments(assignmentId: string) {
  return useQuery({
    queryKey: [DOCUMENTS_KEY, assignmentId],
    queryFn: () =>
      api
        .get<{ success: boolean; data: { documents: Document[]; checklist: unknown[] } }>(`/documents/${assignmentId}`)
        .then((r) => r.data.data.documents),
    enabled: !!assignmentId,
    refetchInterval: (query) => {
      // Poll while any doc is still processing OCR
      const hasPending = query.state.data?.some(
        (d) => d.ocrStatus === 'PENDING' || d.ocrStatus === 'QUEUED' || d.ocrStatus === 'PROCESSING',
      );
      return hasPending ? 10_000 : false;
    },
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, file, documentType, photoCategory }: { assignmentId: string; file: File; documentType: string; photoCategory?: string }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('documentType', documentType);
      if (photoCategory) form.append('photoCategory', photoCategory);
      return api.post<{ data: Document }>(`/documents/${assignmentId}/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data);
    },
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: [DOCUMENTS_KEY, vars.assignmentId] }),
  });
}

export function useDocumentDownloadUrl(documentId: string) {
  return useQuery({
    queryKey: [DOCUMENTS_KEY, documentId, 'url'],
    queryFn: () =>
      api
        .get<{ success: boolean; data: { downloadUrl: string } }>(`/documents/${documentId}/download-url`)
        .then((r) => r.data.data.downloadUrl),
    enabled: !!documentId,
    staleTime: 10 * 60 * 1000, // 10 min (URL valid for 15 min)
    gcTime: 12 * 60 * 1000,
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; assignmentId: string }) =>
      api.delete(`/documents/${id}`).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: [DOCUMENTS_KEY, vars.assignmentId] }),
  });
}
