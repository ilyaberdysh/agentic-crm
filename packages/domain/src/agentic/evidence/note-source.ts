import { agentCapabilityGrantSchema, agenticPolicyVersion, agentPrincipalSchema } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import type { PolicyResolver } from '../../permissions.ts';
import { loadDefinitionsByIds } from '../../schema/model.ts';
import type { AgentAuthoritySource, AgenticPolicy } from '../policy.ts';
import type { EvidenceSource } from './contracts.ts';

/** First primary-source adapter: persisted note text. Agent-authored/model-derived note text is not primary. */
export function createNoteEvidenceSource(options: {
  policy: AgenticPolicy;
  resolver: PolicyResolver;
  agents?: AgentAuthoritySource;
}): EvidenceSource {
  return {
    async load(tx, source, scope) {
      await options.policy.assertCan(tx, {
        capability: 'agentic.action.propose',
        scope,
        policyVersion: agenticPolicyVersion,
      });
      let readerMemberId: string;
      if (tx.ctx.actor.type === 'workspace-member') readerMemberId = tx.ctx.actor.id!;
      else {
        const principal = agentPrincipalSchema.safeParse(await options.agents?.principalOf(tx));
        if (!principal.success) return null;
        const grant = agentCapabilityGrantSchema.safeParse(await options.agents?.loadGrant(tx, principal.data.grantId));
        if (
          !grant.success ||
          grant.data.workspaceId !== tx.workspaceId ||
          grant.data.id !== principal.data.grantId ||
          grant.data.agentId !== principal.data.id ||
          grant.data.revokedAt !== null ||
          Date.parse(grant.data.expiresAt) <= Date.parse(tx.now) ||
          !grant.data.capabilities.includes('agentic.action.propose') ||
          grant.data.scope.entityDefinitionId !== scope.entityDefinitionId ||
          grant.data.scope.entityInstanceId !== scope.entityInstanceId
        )
          return null;
        readerMemberId = grant.data.delegatedByMemberId;
      }
      const { rows } = await sql<{
        document_id: string;
        version: string;
        text: string;
        updated_by: { type: string } | null;
        updated_at: string;
      }>`
        SELECT d.id AS document_id, d.version::text AS version, coalesce(d.search_text, '') AS text, d.updated_by, n.updated_at
        FROM notes n JOIN documents d ON d.workspace_id = n.workspace_id AND d.id = n.document_id AND d.parent_ref = n.id AND d.doc_type = 'note'
        JOIN note_records nr ON nr.workspace_id = n.workspace_id AND nr.note_id = n.id
        WHERE n.workspace_id = ${tx.workspaceId}::uuid AND n.id = ${source.id}::uuid
        AND nr.entity_definition_id = ${scope.entityDefinitionId}::uuid AND nr.entity_instance_id = ${scope.entityInstanceId}::uuid
        AND n.deleted_at IS NULL AND d.deleted_at IS NULL FOR SHARE OF n, d`.execute(tx.db);
      const row = rows[0];
      if (!row) return null;
      const definition = (await loadDefinitionsByIds(tx, [scope.entityDefinitionId])).get(scope.entityDefinitionId);
      if (!definition) return null;
      const members = await tx.db
        .selectFrom('workspace_members')
        .select(['id', 'access_level'])
        .where('workspace_id', '=', tx.workspaceId)
        .where('removed_at', 'is', null)
        .where('access_level', 'in', ['admin', 'member'])
        .execute();
      const audienceMemberIds: string[] = [];
      for (const member of members) {
        const flags = await options.resolver.resolve(tx, { memberId: member.id, accessLevel: member.access_level }, [
          definition,
        ]);
        if (flags.get(definition.id)?.read_entity_instance === true) audienceMemberIds.push(member.id);
      }
      return {
        workspaceId: tx.workspaceId,
        scope,
        version: `${row.document_id}:${row.version}:${row.updated_at}`,
        text: row.text,
        primary: row.updated_by?.type === 'workspace-member',
        audienceMemberIds,
        readerMemberId,
      };
    },
  };
}
