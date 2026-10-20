// Runtime values of the evaluator, per kind:
//   text, domain → string · number, currency, rating → number · checkbox → boolean · date → "YYYY-MM-DD" ·
//   timestamp → epoch milliseconds · pipeline/select → {id, title} · entity-reference → {entityDefinitionId,
//   entityInstanceId} · actor-reference → {type, id, name, email} · location → address object · email-address →
//   {email, domain} · phone-number → {normalized, original, countryCode} · personal-name → {fullName, firstName,
//   lastName} · interaction → {interactedAt, interactedWith, interactionType} · arrays → RV[] · empty → null.

export interface OptionValue {
  id: string;
  title: string;
}
export interface RecordValue {
  entityDefinitionId: string | null;
  entityInstanceId: string;
}
export interface ActorValue {
  type: string;
  id: string;
  name: string | null;
  email: string | null;
}
export interface LocationValue {
  line1: string | null;
  line2: string | null;
  line3: string | null;
  line4: string | null;
  locality: string | null;
  region: string | null;
  postcode: string | null;
  countryCode: string | null;
}
export interface EmailValue {
  email: string;
  domain: string | null;
}
export interface PhoneValue {
  normalized: string;
  original: string | null;
  countryCode: string | null;
}
export interface NameValue {
  fullName: string;
  firstName: string;
  lastName: string;
}
export interface InteractionValue {
  interactedAt: number;
  interactedWith: ActorValue | null;
  interactionType: string;
}

export type RV =
  | null
  | string
  | number
  | boolean
  | OptionValue
  | RecordValue
  | ActorValue
  | LocationValue
  | EmailValue
  | PhoneValue
  | NameValue
  | InteractionValue
  | RV[];

/** One historical value row of an attribute on a record (multi-value attributes have overlapping rows). */
export interface HistoryEntry {
  value: RV;
  /** epoch ms */
  activeFrom: number;
  activeUntil: number | null;
}

export const isEmpty = (x: RV): boolean => x === null || x === '' || (Array.isArray(x) && x.length === 0);
