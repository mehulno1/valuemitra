import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import type { ReportStatus, BankCode, PropertyType } from '@valuemitra/shared';

const REPORTS_KEY = 'reports';
const TEMPLATES_KEY = 'report-templates';

export interface ReportTemplate {
  id: string;
  name: string;
  bankCode: BankCode;
  propertyType: PropertyType;
  isUnderConstruction: boolean;
}

export interface Report {
  id: string;
  assignmentId: string;
  templateId: string;
  status: ReportStatus;
  docxKey?: string;
  pdfKey?: string;
  docxSignedUrl?: string;
  pdfSignedUrl?: string;
  generatedAt?: string;
  createdAt: string;
  template?: { name: string };
}

export function useReportTemplates(filters?: { bankCode?: BankCode; propertyType?: PropertyType }) {
  return useQuery({
    queryKey: [TEMPLATES_KEY, filters],
    queryFn: () =>
      api
        .get<{ success: boolean; data: ReportTemplate[] }>('/reports/templates', { params: filters })
        .then((r) => r.data.data),
  });
}

export function useReports(assignmentId: string) {
  return useQuery({
    queryKey: [REPORTS_KEY, assignmentId],
    queryFn: () =>
      api
        .get<{ success: boolean; data: Report[] }>(`/reports/assignment/${assignmentId}`)
        .then((r) => r.data.data),
    enabled: !!assignmentId,
  });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { assignmentId: string; templateId: string; valuationRunId?: string }) =>
      api.post<{ data: Report }>('/reports/generate', data).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: [REPORTS_KEY, vars.assignmentId] }),
  });
}

export function useDeliverReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      reportId,
      data,
    }: {
      reportId: string;
      assignmentId: string;
      data: { recipientEmail: string; recipientName: string; message?: string; includeDocx?: boolean };
    }) => api.post(`/reports/${reportId}/deliver`, data).then((r) => r.data),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: [REPORTS_KEY, vars.assignmentId] }),
  });
}
