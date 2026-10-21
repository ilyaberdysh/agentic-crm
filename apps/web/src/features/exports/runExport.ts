// "Export view as CSV": a sticky toast
// "<Object> - <View> Export" that walks Preparing → Collecting data (progress) → Building CSV file → Downloading export
// → "Export complete" (5 s), or "No records to export" / "Failed to export" / "Failed to download".
import { toast } from '@agentic-crm/ui';
import type { WorkspaceRef } from '../../data/trpc';
import { exportsBackend } from './data';

const POLL_MS = 600;
const DONE_MS = 5000;
const DOWNLOAD_RETRIES = 3;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RunExportInput {
  viewId: string;
  /** "[seed] Projects - All Projects Export". */
  title: string;
  /** Default file name when the server does not name it. */
  fileName: string;
}

function download(url: string, name: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function runExport(ws: WorkspaceRef, input: RunExportInput): Promise<void> {
  const id = toast({
    title: input.title,
    description: 'Preparing',
    durationMs: Number.POSITIVE_INFINITY,
    icon: 'spinner',
    progress: 0,
  });
  const fail = (title: string) => {
    toast.dismiss(id);
    toast.error({ title, durationMs: DONE_MS });
  };
  try {
    const backend = exportsBackend(ws);
    const { exportId } = await backend.create({ viewId: input.viewId, format: 'csv' });
    for (;;) {
      const job = await backend.status(exportId);
      if (job.status === 'failed') {
        return fail(job.failureReason === 'instance-count-zero' ? 'No records to export' : 'Failed to export');
      }
      if (job.status === 'complete') break;
      toast.update(id, {
        description:
          job.status === 'in-progress' ? (job.progress >= 100 ? 'Building CSV file' : 'Collecting data') : 'Preparing',
        progress: job.progress / 100,
      });
      await wait(POLL_MS);
    }
    toast.update(id, { description: 'Building CSV file', progress: 1 });
    toast.update(id, { description: 'Downloading export' });
    let file: { url: string; fileName: string } | null = null;
    for (let attempt = 0; attempt < DOWNLOAD_RETRIES && !file; attempt++) {
      try {
        file = await backend.downloadUrl(exportId);
      } catch {
        await wait(POLL_MS);
      }
    }
    if (!file) return fail('Failed to download');
    download(file.url, file.fileName || `${input.fileName}.csv`);
    toast.dismiss(id);
    toast.success({ title: input.title, description: 'Export complete', durationMs: DONE_MS });
  } catch {
    fail('Something went wrong starting your export');
  }
}
