// Chip ⇄ text serialization of the formula editor. The editor holds *editor text* where every
// reference is a token `_{<uuid>}` bound to its annotation through a token map; the stored form (and everything sent
// to the API) is `plaintext` with one `_` per reference plus annotations pointing at those placeholders. Token ids
// are ephemeral: fresh UUIDs on every load. Copying a selection that contains chips puts
// `{version:1, plaintext, annotations}` on the clipboard so a paste restores the chips.
import type { FormulaSourceInput } from '@agentic-crm/contracts';
import {
  type FormulaAnnotation,
  type FormulaSource,
  fromEditorSource,
  REFERENCE_TOKEN_RE,
  toEditorSource,
} from '@agentic-crm/formula';
import { newId } from '../../../lib/ids';

export type TokenMap = ReadonlyMap<string, FormulaAnnotation>;

export interface EditorDoc {
  text: string;
  tokens: Map<string, FormulaAnnotation>;
}

export const tokenText = (id: string): string => `_{${id}}`;

/** Stored form → editor text with fresh token ids. */
export function loadSource(source: FormulaSource | null | undefined, mintId: () => string = newId): EditorDoc {
  if (!source) return { text: '', tokens: new Map() };
  const { text, tokens } = toEditorSource(source, () => mintId());
  return { text, tokens };
}

/** Editor text → stored form (tokens missing from the map stay literal text). */
export function storedSource(text: string, tokens: TokenMap): FormulaSource {
  const { plaintext, annotations } = fromEditorSource({ text, tokens: new Map(tokens) });
  return { plaintext, annotations };
}

/** Reference tokens of an editor text (offsets in editor coordinates). */
export function tokensIn(text: string): { from: number; to: number; id: string }[] {
  const out: { from: number; to: number; id: string }[] = [];
  for (const m of text.matchAll(REFERENCE_TOKEN_RE)) {
    out.push({ from: m.index, to: m.index + m[0].length, id: m[1] as string });
  }
  return out;
}

/** Editor offset → plaintext offset (a token collapses to its `_`). */
export function plainOffset(text: string, offset: number): number {
  let shift = 0;
  for (const t of tokensIn(text)) {
    if (t.from >= offset) break;
    if (offset < t.to) return t.from - shift + 1;
    shift += t.to - t.from - 1;
  }
  return offset - shift;
}

export const CLIPBOARD_VERSION = 1;

/** The clipboard text for an editor slice: JSON with chips when it contains any, else the plain text. */
export function clipboardText(slice: string, tokens: TokenMap): string {
  const source = storedSource(slice, tokens);
  if (source.annotations.length === 0) return slice;
  return JSON.stringify({ version: CLIPBOARD_VERSION, plaintext: source.plaintext, annotations: source.annotations });
}

/** A pasted clipboard payload with chips, or null for plain text. */
export function parseClipboard(text: string): FormulaSource | null {
  if (!text.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text) as { version?: unknown; plaintext?: unknown; annotations?: unknown };
    if (parsed.version !== CLIPBOARD_VERSION || typeof parsed.plaintext !== 'string') return null;
    if (!Array.isArray(parsed.annotations)) return null;
    const annotations = (parsed.annotations as FormulaAnnotation[]).filter(
      (a) => a && typeof a === 'object' && typeof a.startPosition === 'number' && typeof a.type === 'string',
    );
    return { plaintext: parsed.plaintext, annotations };
  } catch {
    return null;
  }
}

/** Same annotation (ignoring position): used to reuse chips and to compare formulas. */
export function sameAnnotation(a: FormulaAnnotation, b: FormulaAnnotation): boolean {
  const strip = ({ startPosition: _s, length: _l, ...rest }: FormulaAnnotation) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/** Two stored formulas are equal (plaintext and annotations at the same positions). */
export function sameSource(a: FormulaSource | null, b: FormulaSource | null): boolean {
  if (!a || !b) return a === b;
  if (a.plaintext !== b.plaintext || a.annotations.length !== b.annotations.length) return false;
  const byPos = (x: FormulaAnnotation, y: FormulaAnnotation) => x.startPosition - y.startPosition;
  const xs = [...a.annotations].sort(byPos);
  const ys = [...b.annotations].sort(byPos);
  return xs.every((x, i) => {
    const y = ys[i] as FormulaAnnotation;
    return x.startPosition === y.startPosition && sameAnnotation(x, y);
  });
}

/**
 * An entity-variable annotation for an attribute path. Currency references use the numeric amount (`raw_value`);
 * other attribute types use the value itself.
 */
export function variableAnnotation(
  path: { entityDefinitionId: string; attributeDefinitionId: string }[],
  field: string | null = null,
) {
  return { type: 'entity-variable', path, field, startPosition: 0, length: 1 } satisfies FormulaAnnotation;
}

/** The sub-field a picked attribute is referenced with. */
export function fieldFor(type: string): string | null {
  return type === 'currency' ? 'raw_value' : null;
}

/** The API's shape of a stored formula (annotations always have length 1). */
export function wireSource(source: FormulaSource): {
  plaintext: string;
  annotations: NonNullable<FormulaSourceInput['annotations']>;
} {
  return {
    plaintext: source.plaintext,
    annotations: source.annotations.map((a) => ({ ...a, length: 1 as const })) as NonNullable<
      FormulaSourceInput['annotations']
    >,
  };
}
