// "Import / Export ▾" of object and list pages (C1 README §3.8; C2 README §2.2; evidence C2/import-export-menu.png):
// Migrate CRM · Import CSV · Export view as CSV · Export view as Excel · Learn about imports and exports. Import opens
// the wizard as an overlay over the page (closing returns here); CSV export runs the export job with its toast. Excel
// is deferred (BACKLOG §4: CSV only).
import { Button, Menu, MenuItem, MenuSeparator, MenuTrigger, toast } from '@agentic-crm/ui';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { beginOverlaySession } from '../imports/wizard/destination';
import { useWorkspace } from '../shell/workspaceContext';
import { runExport } from './runExport';

export interface ImportExportMenuProps {
  /** Route prefix of the destination below the workspace (`custom/projects`, `collection/<listId>`). */
  base: string;
  /** Object plural noun / list name ("[seed] Projects"). */
  title: string;
  viewId: string;
  viewTitle: string;
  /** The member may create records (Import CSV creates them); false disables the item (Read only access). */
  canImport?: boolean;
}

export function ImportExportMenu({ base, title, viewId, viewTitle, canImport = true }: ImportExportMenuProps) {
  const { href, workspace } = useWorkspace();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.href });
  return (
    <MenuTrigger>
      <Button variant="secondary" size={28} icon="download" chevron data-testid="import-export-button">
        Import / Export
      </Button>
      <Menu
        aria-label="Import / Export"
        placement="bottom end"
        width={262}
        onAction={(key) => {
          if (key === 'migrate') void router.navigate({ href: href('settings/migration') });
          if (key === 'import-csv') {
            beginOverlaySession(pathname);
            void router.navigate({ href: href(`${base}/import/new`) });
          }
          if (key === 'export-csv')
            void runExport(
              { id: workspace.id, slug: workspace.slug },
              { viewId, title: `${title} - ${viewTitle} Export`, fileName: `${title} - ${viewTitle}` },
            );
          if (key === 'export-excel')
            toast({
              title: 'Export view as Excel',
              description: 'Excel export is not available yet. Export as CSV instead.',
            });
          if (key === 'learn')
            toast({ title: 'Imports and exports', description: 'Help articles arrive with the help center.' });
        }}
      >
        <MenuItem id="migrate" icon="migrate">
          Migrate CRM
        </MenuItem>
        <MenuSeparator />
        <MenuItem id="import-csv" icon="importCsv" isDisabled={!canImport}>
          Import CSV
        </MenuItem>
        <MenuSeparator />
        <MenuItem id="export-csv" icon="exportCsv">
          Export view as CSV
        </MenuItem>
        <MenuItem id="export-excel" icon="exportSpreadsheet">
          Export view as Excel
        </MenuItem>
        <MenuSeparator />
        <MenuItem id="learn" icon="help" variant="link">
          Learn about imports and exports
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
