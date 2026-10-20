// Where an import goes and where its routes live (C2 README §1, import.md §I1): objects at `/{slug}` (standard) or
// `/custom/{slug}`, lists at `/collection/{listId}`, and the settings variants `/settings/data/objects/{slug}/imports`
// and `/settings/data/lists/{listId}/imports`. All share `…/import/new` and
// `…/import/{importMappingId}/job/{importJobId}/{map-properties|review-values[/{propertyId}]|preview[/{edId}]|overview[/{edId}]}`.
import type { EntityDefinition } from '@agentic-crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { objectPath } from '../../../data/objects';
import { definitionsQuery } from '../../views/data';
import { useImportsWorkspace } from '../data/backend';

export type DestinationRef = { kind: 'object'; apiSlug: string } | { kind: 'list'; listId: string };

export type WizardStep = 'upload' | 'map-properties' | 'review-values' | 'preview' | 'overview';

export interface WizardLocation {
  step: WizardStep;
  importId: string | null;
  jobId: string | null;
  /** review-values/{propertyId}, preview/{edId}, overview/{edId}. */
  param: string | null;
}

/** `new`, `{m}/job/{j}`, `{m}/job/{j}/map-properties`, `…/review-values/{p}`, … → location (null = unknown path). */
export function parseWizardPath(splat: string): WizardLocation | null {
  const parts = splat.split('/').filter(Boolean);
  if (parts.length === 0 || (parts.length === 1 && parts[0] === 'new'))
    return { step: 'upload', importId: null, jobId: null, param: null };
  const [importId, job, jobId, step, param] = parts;
  if (!importId || job !== 'job' || !jobId) return null;
  if (!step) return { step: 'map-properties', importId, jobId, param: null };
  if (step === 'upload') return { step: 'upload', importId, jobId, param: null };
  if (step === 'map-properties' || step === 'review-values' || step === 'preview' || step === 'overview')
    return { step, importId, jobId, param: param ?? null };
  return null;
}

/** Path of a wizard location below the destination's base (without the workspace slug). */
export function wizardPath(base: string, loc: Partial<WizardLocation> & { step: WizardStep }): string {
  if (!loc.importId || !loc.jobId) return `${base}/import/new`;
  const job = `${base}/import/${loc.importId}/job/${loc.jobId}`;
  if (loc.step === 'upload') return `${job}/upload`;
  return loc.param ? `${job}/${loc.step}/${loc.param}` : `${job}/${loc.step}`;
}

export interface ResolvedDestination {
  definition: EntityDefinition;
  isList: boolean;
  /** "[seed] Projects", the list name. */
  title: string;
  /** The object / list page below the workspace (close target, breadcrumb link). */
  pagePath: string;
}

/** The destination definition (objects by slug, lists by id — a list's entry definition shares its id). */
export function useDestination(ref: DestinationRef): { destination: ResolvedDestination | null; isPending: boolean } {
  const ws = useImportsWorkspace();
  const defs = useQuery(definitionsQuery(ws));
  if (!defs.data) return { destination: null, isPending: defs.isPending };
  const definition =
    ref.kind === 'object'
      ? defs.data.find((d) => d.apiSlug === ref.apiSlug && d.entityType !== 'collection-entry' && !d.isArchived)
      : defs.data.find((d) => d.id === ref.listId);
  if (!definition) return { destination: null, isPending: false };
  const isList = definition.entityType === 'collection-entry';
  return {
    destination: {
      definition,
      isList,
      title: definition.pluralNoun,
      pagePath: isList ? `collection/${definition.id}` : objectPath(definition),
    },
    isPending: false,
  };
}

// ---- overlay session -------------------------------------------------------------------------------------------------

/**
 * Opened from the app (Import / Export menu, empty states) the wizard is an overlay sheet that closes back to where it
 * was opened (Esc keeps the draft); opened by URL it is a page with breadcrumbs (import.md §I1).
 */
let session: { overlay: boolean; returnTo: string | null } = { overlay: false, returnTo: null };

export function beginOverlaySession(returnTo: string): void {
  session = { overlay: true, returnTo };
}

export function endOverlaySession(): void {
  session = { overlay: false, returnTo: null };
}

export function overlaySession(): { overlay: boolean; returnTo: string | null } {
  return session;
}

/** Opens the import wizard over the current page (Import CSV buttons of empty states, the Import / Export menu). */
export function openImportWizard(
  navigate: (opts: { href: string }) => unknown,
  href: (path: string) => string,
  base: string,
  returnTo: string = window.location.pathname + window.location.search,
): void {
  beginOverlaySession(returnTo);
  void navigate({ href: href(`${base}/import/new`) });
}
