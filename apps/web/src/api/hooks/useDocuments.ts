import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { OCRStatus, DocumentType } from '@valuemitra/shared';

const DOCUMENTS_KEY = 'documents';

export interface Document {
  id: string;
  assignmentId: string;
  documentType: DocumentType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  ocrStatus: OCRStatus;
  storageKey: string;
  storageProvider: string;
  uploadedBy: { fullName: string };
  createdAt: string;
  signedUrl?: string;
}

export function useDocuments(assignmentId: string) {
  return useQuery({
    queryKey: [DOCUMENTS_KEY, assignmentId],
    queryFn: () =>
      api
        .get<{ success: boolean; data: Document[] }>('/documents', { params: { assignmentId } })
        .then((r) => r.data.data),
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
    mutationFn: ({ assignmentId, file, documentType }: { assignmentId: string; file: File; documentType: string }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('assignmentId', assignmentId);
      form.append('documentType', documentType);
      return api.post<{ data: Document }>('/documents', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data);
    },
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: [DOCUMENTS_KEY, vars.assignmentId] }),
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
