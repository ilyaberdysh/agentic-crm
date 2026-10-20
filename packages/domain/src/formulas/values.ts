// Bridges between stored attribute values and the formula evaluator's runtime values:
//   attribute_values row → RV (references, history), RV → write-form value (formula output, preview).
import type { AttributeType } from '@agentic-crm/contracts';
import type {
  ActorValue,
  EmailValue,
  InteractionValue,
  LocationValue,
  NameValue,
  OptionValue,
  OutputKind,
  PhoneValue,
  RecordValue,
  RV,
} from '@agentic-crm/formula';
import type { ValueRowLike } from '../values/codecs.ts';

export interface RowLookups {
  /** select option / pipeline stage id → title */
  optionTitle(id: string): string;
  /** workspace member id → name and email */
  member(id: string): { name: string | null; email: string | null } | null;
}

const num = (x: string | number | null) => (x === null ? null : Number(x));
const obj = (x: unknown) => (x ?? {}) as Record<string, unknown>;
const str = (x: unknown) => (typeof x === 'string' ? x : null);

export function actorRV(type: string, id: string, lookups: RowLookups): ActorValue {
  const m = type === 'workspace-member' ? lookups.member(id) : null;
  return { type, id, name: m?.name ?? null, email: m?.email ?? null };
}

/** One stored value row → runtime value of its attribute type. */
export function rowToRV(type: AttributeType, row: ValueRowLike, lookups: RowLookups): RV {
  switch (type) {
    case 'text':
    case 'domain':
      return row.v_text;
    case 'number':
    case 'rating':
    case 'currency':
      return num(row.v_num);
    case 'checkbox':
      return row.v_bool;
    case 'date':
      return row.v_date;
    case 'timestamp':
      return row.v_ts === null ? null : Date.parse(row.v_ts);
    case 'pipeline':
    case 'select':
      return row.v_ref === null ? null : ({ id: row.v_ref, title: lookups.optionTitle(row.v_ref) } as OptionValue);
    case 'entity-reference':
      return row.v_ref === null
        ? null
        : ({ entityDefinitionId: row.v_ref_def, entityInstanceId: row.v_ref } as RecordValue);
    case 'actor-reference':
      return row.v_ref === null ? null : actorRV(row.v_text ?? 'workspace-member', row.v_ref, lookups);
    case 'location': {
      const j = obj(row.v_json);
      return {
        line1: str(j.line1),
        line2: str(j.line2),
        line3: str(j.line3),
        line4: str(j.line4),
        locality: str(j.locality),
        region: str(j.region),
        postcode: str(j.postcode),
        countryCode: str(j.countryCode),
      } satisfies LocationValue;
    }
    case 'email-address':
      return row.v_text === null
        ? null
        : ({ email: row.v_text, domain: str(obj(row.v_json).emailDomain) } satisfies EmailValue);
    case 'phone-number':
      return row.v_text === null
        ? null
        : ({
            normalized: row.v_text,
            original: str(obj(row.v_json).originalPhoneNumber),
            countryCode: str(obj(row.v_json).countryCode),
          } satisfies PhoneValue);
    case 'personal-name':
      return row.v_text === null
        ? null
        : ({
            fullName: row.v_text,
            firstName: str(obj(row.v_json).firstName) ?? '',
            lastName: str(obj(row.v_json).lastName) ?? '',
          } satisfies NameValue);
    case 'interaction':
      return row.v_ts === null
        ? null
        : ({
            interactedAt: Date.parse(row.v_ts),
            interactedWith: row.v_ref ? actorRV('workspace-member', row.v_ref, lookups) : null,
            interactionType: row.v_text ?? '',
          } satisfies InteractionValue);
  }
}

/** Formula output (runtime value of the output kind) → write-form value of the attribute (null = clear). */
export function outputToWriteValue(kind: OutputKind, value: RV): unknown {
  if (value === null) return null;
  switch (kind) {
    case 'text':
      return value === '' ? null : value;
    case 'number':
      return Number.isFinite(value as number) ? value : null;
    case 'rating':
      return value;
    case 'checkbox':
      return value;
    case 'currency':
      return { currencyValue: value as number, currencyCode: null };
    case 'date':
      return value;
    case 'timestamp':
      return new Date(value as number).toISOString();
    case 'entity-reference': {
      const r = value as RecordValue;
      return {
        entityInstanceId: r.entityInstanceId,
        ...(r.entityDefinitionId ? { entityDefinitionId: r.entityDefinitionId } : {}),
      };
    }
    case 'actor-reference': {
      const a = value as ActorValue;
      return { referencedActorType: a.type, referencedActorId: a.id };
    }
    case 'location': {
      const l = value as LocationValue;
      return { ...l };
    }
    case 'phone-number':
      return { originalPhoneNumber: (value as PhoneValue).normalized };
  }
}
