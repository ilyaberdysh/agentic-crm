// View export: `exports.create({exportId, viewId, format, locale,
// timeZone})` freezes the saved view (filter, sorts, columns — kanban: the grouping attribute first, then the card
// attributes) and queues the worker job; `exports.status` reports Preparing / Collecting data (progress) / complete /
// failed; `exports.downloadUrl` hands out a signed URL valid for 5 minutes.
import { api, inWorkspace, noteAcceptAfter, type RouterOutputs, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';

type ServerExport = RouterOutputs['exports']['status'];
export type ExportStatus = ServerExport['status'];

export interface ExportJob {
  exportId: string;
  status: ExportStatus;
  /** 0–100. */
  progress: number;
  failureReason: string | null;
  fileName: string;
}

export interface ExportsBackend {
  create(input: { viewId: string; format: 'csv' }): Promise<{ exportId: string }>;
  status(exportId: string): Promise<ExportJob>;
  /** Short-lived URL of the finished file. */
  downloadUrl(exportId: string): Promise<{ url: string; fileName: string }>;
}

const jobIn = (e: ServerExport): ExportJob => ({
  exportId: e.id,
  status: e.status,
  progress: e.progress,
  failureReason: e.failureReason,
  fileName: e.fileName,
});

/** The viewer's locale and time zone format the file (numbers, currency, dates —). */
function viewerFormat(): { locale: string; timeZone: string } {
  return {
    locale: typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function exportsBackend(ws: WorkspaceRef): ExportsBackend {
  const call = inWorkspace(ws);
  return {
    async create({ viewId, format }) {
      // Client-minted id: a retried create starts one export.
      const res = await api.exports.create.mutate({ exportId: newId(), viewId, format, ...viewerFormat() }, call);
      noteAcceptAfter(ws.id, res.seq);
      return { exportId: res.exportId };
    },
    status: async (exportId) => jobIn(await api.exports.status.query({ exportId }, call)),
    downloadUrl: async (exportId) => {
      const { url, fileName } = await api.exports.downloadUrl.query({ exportId }, call);
      return { url, fileName };
    },
  };
}
