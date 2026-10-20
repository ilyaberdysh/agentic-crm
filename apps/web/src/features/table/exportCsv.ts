// CSV export of rows (C1 README §3.8 "Export view as CSV"; bulk "Export"): record title + the view's columns, cell
// text from the registry's `copyText` (same formatting as the clipboard), values loaded in batches through the
// slice-1 loaders. Runs in the browser (the server-side export job of Attio is not built yet).
import type { AttributeDefinition, AttributeValue } from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import type { WorkspaceRef } from '../../data/trpc';
import type { TableColumn } from './columns';
import { loadPathValues, titleText } from './values';

export function csvEscape(text: string): string {
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

export interface ExportInput {
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  singularNoun: string;
  titleAttribute: AttributeDefinition | undefined;
  columns: TableColumn[];
  recordIds: string[];
  fileName: string;
  title: string;
}

export async function exportCsv(input: ExportInput): Promise<void> {
  const id = toast({
    title: input.title,
    description: 'Preparing',
    progress: 0,
    durationMs: Number.POSITIVE_INFINITY,
    icon: 'spinner',
  });
  try {
    if (input.recordIds.length === 0) {
      toast.dismiss(id);
      toast.error('No records to export');
      return;
    }
    toast.update(id, { description: 'Collecting data', progress: 0.1 });
    const titles = input.titleAttribute
      ? await loadPathValues(
          input.workspace,
          [{ entityDefinitionId: input.entityDefinitionId, attributeDefinitionId: input.titleAttribute.id }],
          input.recordIds,
        )
      : null;
    const perColumn: Map<string, AttributeValue[]>[] = [];
    let done = 0;
    for (const column of input.columns) {
      perColumn.push(
        column.attribute ? await loadPathValues(input.workspace, column.column.path, input.recordIds) : new Map(),
      );
      done += 1;
      toast.update(id, { progress: 0.1 + 0.8 * (done / Math.max(1, input.columns.length)) });
    }
    toast.update(id, { description: 'Building CSV file', progress: 0.95 });
    const header = [input.singularNoun, ...input.columns.map((c) => c.title)];
    const rows = input.recordIds.map((recordId) => [
      titles ? titleText(input.titleAttribute, titles.get(recordId)) : recordId,
      ...input.columns.map((column, i) =>
        column.attribute
          ? column.ui.copyText(perColumn[i]?.get(recordId) ?? [], column.attribute, { field: column.field })
          : '',
      ),
    ]);
    download(`${input.fileName}.csv`, toCsv([header, ...rows]));
    toast.dismiss(id);
    toast.success({ title: input.title, description: 'Export complete' });
  } catch (error) {
    toast.dismiss(id);
    toast.error({ title: 'Failed to export', description: error instanceof Error ? error.message : undefined });
  }
}

function download(name: string, text: string): void {
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
