// Selections over a query snapshot as index intervals ("zebra edges", A internal-api-shapes §3): a sorted list of
// half-open interval edges [s0, e0, s1, e1, …] over snapshot row indices. "Select all" over 1M rows is [0, total].
// Shared by the client (building selections) and the server (resolving them to ids).

export type ZebraEdges = number[];

/** Sorted, even-length, strictly increasing, non-negative integer edges. */
export function isValidZebra(edges: readonly number[]): boolean {
  if (edges.length % 2 !== 0) return false;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i] as number;
    if (!Number.isInteger(e) || e < 0) return false;
    if (i > 0 && e <= (edges[i - 1] as number)) return false;
  }
  return true;
}

/** Number of selected rows. */
export function zebraSize(edges: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < edges.length; i += 2) n += (edges[i + 1] as number) - (edges[i] as number);
  return n;
}

export function zebraContains(edges: readonly number[], index: number): boolean {
  for (let i = 0; i < edges.length; i += 2) {
    if (index >= (edges[i] as number) && index < (edges[i + 1] as number)) return true;
  }
  return false;
}

/** Builds canonical edges from arbitrary indices (duplicates ignored). */
export function zebraFromIndices(indices: Iterable<number>): ZebraEdges {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const edges: number[] = [];
  for (const i of sorted) {
    if (edges.length > 0 && edges[edges.length - 1] === i) edges[edges.length - 1] = i + 1;
    else edges.push(i, i + 1);
  }
  return edges;
}

/** Union of two selections, merged into canonical form. */
export function zebraUnion(a: readonly number[], b: readonly number[]): ZebraEdges {
  const intervals: [number, number][] = [];
  for (const edges of [a, b]) {
    for (let i = 0; i < edges.length; i += 2) intervals.push([edges[i] as number, edges[i + 1] as number]);
  }
  intervals.sort((x, y) => x[0] - y[0]);
  const out: number[] = [];
  for (const [s, e] of intervals) {
    const last = out.length - 1;
    if (out.length > 0 && s <= (out[last] as number)) out[last] = Math.max(out[last] as number, e);
    else out.push(s, e);
  }
  return out;
}

/** Flips one row in or out of the selection. */
export function zebraToggle(edges: readonly number[], index: number): ZebraEdges {
  if (!zebraContains(edges, index)) return zebraUnion(edges, [index, index + 1]);
  const out: number[] = [];
  for (let i = 0; i < edges.length; i += 2) {
    const s = edges[i] as number;
    const e = edges[i + 1] as number;
    if (index < s || index >= e) out.push(s, e);
    else {
      if (s < index) out.push(s, index);
      if (index + 1 < e) out.push(index + 1, e);
    }
  }
  return out;
}

/** Clamps a selection to [0, total) and drops empty intervals. */
export function zebraClamp(edges: readonly number[], total: number): ZebraEdges {
  const out: number[] = [];
  for (let i = 0; i < edges.length; i += 2) {
    const s = Math.max(0, edges[i] as number);
    const e = Math.min(total, edges[i + 1] as number);
    if (e > s) out.push(s, e);
  }
  return out;
}
