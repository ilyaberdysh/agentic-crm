// Record actions: the Actions menu of a record row (⌘K on a highlighted search result) and
// the actions the focused table row contributes to the palette — Open record (↩), Open in a new tab (⌘↩), Copy domain /
// Copy email address (⌘), Create task, Create note, Merge record with…, Send email (people only).
import { toast } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { ObjectSummary } from '../../data/objects';
import { api, inWorkspace } from '../../data/trpc';
import { openComposer } from '../composer/open';
import { openNewNote } from '../notes/NewNote';
import { recordUrl } from '../record/paths';
import { requestRecordDialog } from '../record/pendingDialog';
import { useWorkspace } from '../shell/workspaceContext';
import { openCreateTask } from '../tasks/TaskDialog';
import type { MenuItem } from './Shell';

/** What the menu needs of an object: where its records live and whether they are people or companies. */
export type ObjectRef = Pick<ObjectSummary, 'entityType' | 'apiSlug'>;

export interface RecordTarget {
  entityDefinitionId: string;
  entityInstanceId: string;
  /** Display name (for the section title and fallbacks). */
  title: string;
  /** Identifiers when already known (a search hit carries them); else they are looked up on demand. */
  domains?: readonly string[];
  emailAddresses?: readonly string[];
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Builds the record menu for a target; `close` closes the palette first. */
export function useRecordMenu(): (
  target: RecordTarget,
  object: ObjectRef | undefined,
  close: () => void,
) => MenuItem[] {
  const { href, workspace } = useWorkspace();
  const navigate = useNavigate();
  return useCallback(
    (target, object, close) => {
      const to = object ? recordUrl(href, object, target.entityInstanceId) : null;
      const isCompany = object?.entityType === 'company-record';
      const isPerson = object?.entityType === 'person-record';
      const ref = { entityDefinitionId: target.entityDefinitionId, entityInstanceId: target.entityInstanceId };

      /** The identifier to copy: the hit's, else a lookup by record id (the search index finds records by id). */
      const identifier = async (kind: 'domains' | 'emailAddresses'): Promise<string | null> => {
        const known = target[kind]?.[0];
        if (known) return known;
        if (target[kind]) return null;
        const res = await api.search.records.query(
          { query: target.entityInstanceId, limit: 1 },
          inWorkspace({ id: workspace.id, slug: workspace.slug }),
        );
        return res.hits[0]?.[kind][0] ?? null;
      };

      const items: MenuItem[] = [
        {
          id: 'open',
          label: 'Open record',
          keys: 'enter',
          run: () => {
            close();
            if (to) void navigate({ href: to });
          },
        },
        {
          id: 'open-new-tab',
          label: 'Open record in a new tab',
          keys: 'mod+enter',
          run: () => {
            close();
            if (to) window.open(to, '_blank', 'noopener');
          },
        },
      ];
      if (isCompany) {
        items.push({
          id: 'copy-domain',
          label: 'Copy domain',
          keys: 'mod+c',
          run: () => {
            close();
            void identifier('domains').then(async (domain) => {
              if (!domain) return void toast.warning({ title: 'Company has no domain to copy' });
              if (await copyText(domain)) toast({ title: 'Copied domain to clipboard' });
              else toast.error({ title: 'Unable to copy company domain' });
            });
          },
        });
      }
      if (isPerson) {
        items.push({
          id: 'copy-email',
          label: 'Copy email address',
          keys: 'mod+c',
          run: () => {
            close();
            void identifier('emailAddresses').then(async (email) => {
              if (!email) return void toast.warning({ title: 'Person has no email address to copy' });
              if (await copyText(email)) toast({ title: 'Copied email address to clipboard' });
              else toast.error({ title: 'Unable to copy email address' });
            });
          },
        });
      }
      items.push(
        {
          id: 'create-task',
          label: 'Create task',
          run: () => {
            close();
            openCreateTask({
              records: [{ entityDefinitionId: ref.entityDefinitionId, entityInstanceId: ref.entityInstanceId }],
            });
          },
        },
        {
          id: 'create-note',
          label: 'Create note',
          run: () => {
            close();
            openNewNote({ record: ref });
          },
        },
      );
      if (isCompany || isPerson) {
        items.push({
          id: 'merge',
          label: 'Merge record with...',
          run: () => {
            close();
            if (!to) return;
            requestRecordDialog(target.entityInstanceId, 'merge');
            void navigate({ href: to });
          },
        });
      }
      if (isPerson) {
        items.push({
          id: 'send-email',
          label: 'Send email',
          run: () => {
            close();
            void identifier('emailAddresses').then((address) =>
              openComposer({
                to: address ? [{ emailAddress: address, name: target.title, record: ref }] : [],
              }),
            );
          },
        });
      }
      return items;
    },
    [href, navigate, workspace.id, workspace.slug],
  );
}
