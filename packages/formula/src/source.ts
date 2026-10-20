// Stored representation (formulas.md §1.6): `plaintext` with a single `_` placeholder per reference plus
// `annotations` pointing at those placeholders. The parser works on *editor text*, where every reference is a token
// `_{<id>}` bound to its annotation through a token map; these helpers convert between the two and map offsets.

export interface PathHop {
  entityDefinitionId: string;
  attributeDefinitionId: string;
}

interface AnnotationBase {
  /** Index of the `_` placeholder in the plaintext. */
  startPosition: number;
  /** Always 1 in plaintext. */
  length: number;
}

export type FormulaAnnotation =
  | (AnnotationBase & {
      type: 'entity-variable';
      /** One hop per relationship traversed; the last hop is the referenced attribute. */
      path: PathHop[];
      /** Sub-field (§3.3), e.g. `raw_value` (currency), `first_name` (personal name); null = the value itself. */
      field: string | null;
      fallbackValue?: string | null;
    })
  | (AnnotationBase & {
      type: 'select-option';
      entityDefinitionId: string;
      attributeDefinitionId: string;
      selectOptionId: string;
    })
  | (AnnotationBase & {
      type: 'pipeline-stage';
      entityDefinitionId: string;
      attributeDefinitionId: string;
      pipelineStageId: string;
    })
  | (AnnotationBase & {
      type: 'actor-reference';
      referencedActorType: string;
      referencedActorId: string;
    });

export interface FormulaSource {
  plaintext: string;
  annotations: FormulaAnnotation[];
}

/** Editor text with `_{id}` tokens and the annotation each token stands for. */
export interface EditorSource {
  text: string;
  tokens: Map<string, FormulaAnnotation>;
}

export const REFERENCE_TOKEN_RE = /_\{([a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)+)\}/g;

/** Token id used for the annotation at `index` when converting stored formulas (stable, valid token syntax). */
export const tokenIdFor = (index: number) => `ref-${index}`;

export interface OffsetMap {
  /** Editor offset → plaintext offset (a token collapses to its one placeholder character). */
  toPlain(offset: number): number;
  /** Plaintext offset → editor offset. */
  toEditor(offset: number): number;
}

interface Segment {
  editorFrom: number;
  editorTo: number;
  plainFrom: number;
}

function offsetMap(segments: Segment[]): OffsetMap {
  return {
    toPlain(offset) {
      let shift = 0;
      for (const s of segments) {
        if (offset <= s.editorFrom) break;
        if (offset < s.editorTo) return s.plainFrom + (offset > s.editorFrom ? 1 : 0);
        shift += s.editorTo - s.editorFrom - 1;
      }
      return offset - shift;
    },
    toEditor(offset) {
      let shift = 0;
      for (const s of segments) {
        if (offset <= s.plainFrom) break;
        shift += s.editorTo - s.editorFrom - 1;
      }
      return offset + shift;
    },
  };
}

/**
 * plaintext + annotations → editor text. Annotations whose position does not hold a `_` are ignored (reported by
 * `validateSource`).
 */
export function toEditorSource(
  source: FormulaSource,
  idFor: (annotation: FormulaAnnotation, index: number) => string = (_a, i) => tokenIdFor(i),
): EditorSource & { map: OffsetMap } {
  const sorted = source.annotations
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => source.plaintext[a.startPosition] === '_')
    .sort((x, y) => x.a.startPosition - y.a.startPosition);
  const tokens = new Map<string, FormulaAnnotation>();
  const segments: Segment[] = [];
  let text = '';
  let cursor = 0;
  for (const { a, i } of sorted) {
    if (a.startPosition < cursor) continue; // duplicate position
    text += source.plaintext.slice(cursor, a.startPosition);
    const id = idFor(a, i);
    const token = `_{${id}}`;
    segments.push({ editorFrom: text.length, editorTo: text.length + token.length, plainFrom: a.startPosition });
    text += token;
    tokens.set(id, a);
    cursor = a.startPosition + 1;
  }
  text += source.plaintext.slice(cursor);
  return { text, tokens, map: offsetMap(segments) };
}

/** Editor text → plaintext + annotations (tokens not in the map stay as literal text). */
export function fromEditorSource(editor: EditorSource): FormulaSource & { map: OffsetMap } {
  const annotations: FormulaAnnotation[] = [];
  const segments: Segment[] = [];
  let plaintext = '';
  let cursor = 0;
  for (const m of editor.text.matchAll(REFERENCE_TOKEN_RE)) {
    const annotation = editor.tokens.get(m[1] as string);
    if (!annotation) continue;
    plaintext += editor.text.slice(cursor, m.index);
    segments.push({ editorFrom: m.index, editorTo: m.index + m[0].length, plainFrom: plaintext.length });
    annotations.push({ ...annotation, startPosition: plaintext.length, length: 1 });
    plaintext += '_';
    cursor = m.index + m[0].length;
  }
  plaintext += editor.text.slice(cursor);
  return { plaintext, annotations, map: offsetMap(segments) };
}

/** Problems with the stored shape itself (positions not on a `_`, duplicates). */
export function validateSource(source: FormulaSource): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const a of source.annotations) {
    if (source.plaintext[a.startPosition] !== '_') problems.push(`annotation at ${a.startPosition} is not on a "_"`);
    if (seen.has(a.startPosition)) problems.push(`two annotations at ${a.startPosition}`);
    seen.add(a.startPosition);
  }
  return problems;
}

/** 1-based line and column of an offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}
