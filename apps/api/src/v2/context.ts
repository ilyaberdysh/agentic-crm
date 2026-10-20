// Per-request context of a /v2 call: the authenticated token, its workspace, the domain service context (actor =
// the API token) and memoised catalog reads (objects, attributes, options, members) shared by the handlers.
import type {
  ApiTokenIdentity,
  AttributeDefinition,
  EntityDefinition,
  MemberSummary,
  PipelineStage,
  SelectOption,
} from '@agentic-crm/contracts';
import type { Domain, ServiceContext } from '@agentic-crm/domain';
import { publicErrors, withHints } from './errors';

/** Entity types the public API exposes as objects (A public-api-mapping §3 #1: interfaces/tasks/members are hidden). */
export const PUBLIC_OBJECT_TYPES = new Set(['person-record', 'company-record', 'standard-object', 'custom-record']);

export type OptionLike = SelectOption | PipelineStage;

export class V2Context {
  readonly ctx: ServiceContext;
  private definitions: Promise<EntityDefinition[]> | null = null;
  private readonly attributes = new Map<string, Promise<AttributeDefinition[]>>();
  private readonly options = new Map<string, Promise<OptionLike[]>>();
  private members: Promise<MemberSummary[]> | null = null;
  private readableIds: Promise<Set<string>> | null = null;

  constructor(
    readonly domain: Domain,
    readonly identity: ApiTokenIdentity,
    readonly webUrl: string,
  ) {
    this.ctx = {
      workspaceId: identity.workspace.id,
      actor: { type: 'api-token', id: identity.token.id },
      // User-level tokens act with their member's grants (slice 6); workspace-level tokens are governed by scopes.
      ...(identity.token.tokenLevel === 'user' && identity.token.authorizedByMemberId
        ? { onBehalfOfMemberId: identity.token.authorizedByMemberId }
        : {}),
    };
  }

  /** Definition ids the token may see (user-level tokens: read access of their member; others: everything). */
  readable(): Promise<Set<string> | null> {
    if (!this.ctx.onBehalfOfMemberId) return Promise.resolve(null);
    this.readableIds ??= (async () => {
      const ids = (await this.allDefinitions()).map((d) => d.id);
      const out = new Set<string>();
      for (let i = 0; i < ids.length; i += 500) {
        const { policies } = await this.domain.policies.resolve(this.ctx, {
          entityDefinitionIds: ids.slice(i, i + 500),
        });
        for (const [id, p] of Object.entries(policies)) {
          if (p.state === 'complete' && p.value.read_entity_definition) out.add(id);
        }
      }
      return out;
    })();
    return this.readableIds;
  }

  /** Whether the token may see a definition (No access hides objects and lists: 404 like an unknown one). */
  async canRead(def: EntityDefinition): Promise<boolean> {
    const readable = await this.readable();
    return readable === null || readable.has(def.id);
  }

  get workspaceId(): string {
    return this.identity.workspace.id;
  }

  /** Every entity definition of the workspace (objects, but also tasks/members as record-reference targets). */
  allDefinitions(): Promise<EntityDefinition[]> {
    this.definitions ??= this.domain.schema.listObjects(this.ctx, { includeArchived: true });
    return this.definitions;
  }

  async definitionById(id: string): Promise<EntityDefinition | undefined> {
    return (await this.allDefinitions()).find((d) => d.id === id);
  }

  /** Resolves `{object}` (slug or id) to a public object; 404 with Attio's message otherwise. */
  async object(slugOrId: string): Promise<EntityDefinition> {
    const key = slugOrId.toLowerCase();
    const def = (await this.allDefinitions()).find(
      (d) => PUBLIC_OBJECT_TYPES.has(d.entityType) && (d.apiSlug === slugOrId || d.id === key),
    );
    if (!def || !(await this.canRead(def))) throw publicErrors.objectNotFound(slugOrId);
    return def;
  }

  /** Resolves `{list}` (api slug or id) to a live list's collection-entry definition; Attio's 404 otherwise. */
  async list(slugOrId: string): Promise<EntityDefinition> {
    const key = slugOrId.toLowerCase();
    const def = (await this.allDefinitions()).find(
      (d) => d.entityType === 'collection-entry' && !d.isArchived && (d.apiSlug === slugOrId || d.id === key),
    );
    if (!def || !(await this.canRead(def))) throw publicErrors.listNotFound(slugOrId);
    return def;
  }

  /** All attributes of a definition (archived and hidden included), in UI order. */
  attributesOf(entityDefinitionId: string): Promise<AttributeDefinition[]> {
    let pending = this.attributes.get(entityDefinitionId);
    if (!pending) {
      pending = this.domain.schema.listAttributes(this.ctx, { entityDefinitionId, includeArchived: true });
      this.attributes.set(entityDefinitionId, pending);
    }
    return pending;
  }

  /** Resolves `{attribute}` (slug or id) on a definition; hidden attributes do not exist publicly. */
  async attribute(def: EntityDefinition, slugOrId: string): Promise<AttributeDefinition> {
    const key = slugOrId.toLowerCase();
    const attr = (await this.attributesOf(def.id)).find((a) => !a.isHidden && (a.apiSlug === slugOrId || a.id === key));
    if (!attr) throw publicErrors.attributeNotFound(slugOrId);
    return attr;
  }

  /** Select options (select) or statuses (status/pipeline) of an attribute, archived included. */
  optionsOf(attr: AttributeDefinition): Promise<OptionLike[]> {
    let pending = this.options.get(attr.id);
    if (!pending) {
      const input = {
        entityDefinitionId: attr.entityDefinitionId,
        attributeDefinitionId: attr.id,
        includeArchived: true,
      };
      pending =
        attr.type === 'pipeline'
          ? this.domain.schema.listStages(this.ctx, input)
          : attr.type === 'select'
            ? this.domain.schema.listOptions(this.ctx, input)
            : Promise.resolve([]);
      this.options.set(attr.id, pending);
    }
    return pending;
  }

  /** Forget memoised catalog reads after a write in the same request. */
  invalidate(): void {
    this.definitions = null;
    this.readableIds = null;
    this.attributes.clear();
    this.options.clear();
  }

  workspaceMembers(): Promise<MemberSummary[]> {
    this.members ??= withHints({}, () => this.domain.members.list(this.ctx));
    return this.members;
  }
}
