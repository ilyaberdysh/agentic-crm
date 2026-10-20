// The grant-based policy resolver (BACKLOG 6.04, B.12): objects and lists resolve to the preset flags of the
// principal's effective level (resolve.ts), intersected with what the wrapped base resolver allows (allow-all by
// default; tests and capabilities may restrict further). A deleted list resolves to No access for everyone.
// Admins are not exempt (OQ-067): their data access follows the grants like everyone else's; what admins always
// keep is the right to manage grants (service.ts canManage).
import { type ActionFlags, actionFlags, flagsForScope } from '@agentic-crm/contracts';
import type { PolicyResolver } from '../permissions.ts';
import { loadResourceGrants } from './grants.ts';
import { effectiveAccess, kindOfDefinition, principalOf } from './resolve.ts';

function intersect(a: ActionFlags, b: ActionFlags): ActionFlags {
  return Object.fromEntries(actionFlags.map((f) => [f, a[f] && b[f]])) as ActionFlags;
}

export function grantResolver(base: PolicyResolver): PolicyResolver {
  return {
    async resolve(tx, subject, definitions) {
      const resolved = await base.resolve(tx, subject, definitions);
      const objects = definitions.filter((d) => kindOfDefinition(d) === 'object');
      const lists = definitions.filter((d) => kindOfDefinition(d) === 'list');
      if (objects.length === 0 && lists.length === 0) return resolved;
      const principal = await principalOf(tx, subject);
      const [objectGrants, listGrants] = await Promise.all([
        objects.length
          ? loadResourceGrants(
              tx,
              'object',
              objects.map((d) => d.id),
            )
          : new Map(),
        lists.length
          ? loadResourceGrants(
              tx,
              'list',
              lists.map((d) => d.id),
            )
          : new Map(),
      ]);
      for (const def of objects) {
        const { level } = effectiveAccess('object', objectGrants.get(def.id), principal);
        resolved.set(def.id, intersect(resolved.get(def.id) ?? flagsForScope('no-access'), flagsForScope(level)));
      }
      for (const def of lists) {
        const level = def.isArchived ? 'no-access' : effectiveAccess('list', listGrants.get(def.id), principal).level;
        resolved.set(def.id, intersect(resolved.get(def.id) ?? flagsForScope('no-access'), flagsForScope(level)));
      }
      return resolved;
    },
  };
}
