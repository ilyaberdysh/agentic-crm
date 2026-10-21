// Tracks which snapshot the table currently shows.
// The query layer always holds the newest snapshot of (view, filter, sorts); the controller decides when the table
// switches to it:
// - while rows are selected the shown snapshot is frozen (selections are index intervals over it); a newer
// snapshot of *different* params raises "View has changed. Clear selection to update.";
// - after the author's own edits the row order is frozen until refresh: a realtime refresh whose row set differs
// from the shown one only by rows this tab edited is not applied;
// - a refresh of the same params is applied once the chunks covering the visible rows are loaded, so scrolled
// tables never flash skeletons; new params apply at once.
// Rows past the first 1000 come from `snapshots.chunk` as they scroll into view.
import { CHUNK_SIZE, type SnapshotPage } from './data';

export interface ShownSnapshot {
  snapshotId: string;
  paramsKey: string;
  total: number;
  accurateAt: string;
  /** Sparse: index → record id once its chunk is loaded. */
  ids: (string | undefined)[];
  loaded: Set<number>;
  loading: Map<number, Promise<void>>;
  /** Chunks that failed to load (retried on the next visible-range change). */
  failed: Set<number>;
}

export type ChunkFetcher = (snapshotId: string, start: number) => Promise<SnapshotPage>;

function fromPage(page: SnapshotPage, paramsKey: string): ShownSnapshot {
  const ids: (string | undefined)[] = new Array(page.total);
  for (let i = 0; i < page.ids.length; i++) ids[page.start + i] = page.ids[i];
  const loaded = new Set<number>();
  if (page.start === 0 && (page.ids.length >= Math.min(CHUNK_SIZE, page.total) || page.total === 0)) loaded.add(0);
  return {
    snapshotId: page.snapshotId,
    paramsKey,
    total: page.total,
    accurateAt: page.accurateAt,
    ids,
    loaded,
    loading: new Map(),
    failed: new Set(),
  };
}

function firstChunkIds(s: ShownSnapshot): Set<string> {
  const out = new Set<string>();
  const n = Math.min(CHUNK_SIZE, s.total);
  for (let i = 0; i < n; i++) {
    const id = s.ids[i];
    if (id) out.add(id);
  }
  return out;
}

/** Same rows apart from the ones this tab edited (they may move, leave or enter the filter). */
export function sameRowsExceptEdited(a: ShownSnapshot, b: ShownSnapshot, edited: ReadonlySet<string>): boolean {
  if (Math.abs(a.total - b.total) > edited.size) return false;
  const x = firstChunkIds(a);
  const y = firstChunkIds(b);
  let diff = 0;
  for (const id of x) if (!y.has(id) && !edited.has(id)) diff++;
  for (const id of y) if (!x.has(id) && !edited.has(id)) diff++;
  // Moves of edited rows across the 1000-row boundary push as many neighbours in or out.
  return diff <= (a.total > CHUNK_SIZE ? 2 * edited.size : 0);
}

export class SnapshotController {
  private shown: ShownSnapshot | null = null;
  /** Newest snapshot not shown yet (held by a selection or the author freeze, or loading its visible chunks). */
  private next: ShownSnapshot | null = null;
  private selectionHold = false;
  private authorFrozen = false;
  private readonly authorEdited = new Set<string>();
  private visible: [number, number] = [0, 0];
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(
    private readonly fetchChunk: ChunkFetcher,
    private readonly onExpired: () => void,
  ) {}

  // ---- external store --------------------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  // ---- reads -----------------------------------------------------------------------------------------------------

  get current(): ShownSnapshot | null {
    return this.shown;
  }

  idAt(index: number): string | undefined {
    return this.shown?.ids[index];
  }

  /** A newer snapshot of other params waits behind the selection. */
  get viewChanged(): boolean {
    return Boolean(this.shown && this.next && this.selectionHold && this.next.paramsKey !== this.shown.paramsKey);
  }

  get isAuthorFrozen(): boolean {
    return this.authorFrozen;
  }

  /** Index of a record in the shown snapshot (loaded chunks only). */
  indexOf(recordId: string): number {
    return this.shown ? this.shown.ids.indexOf(recordId) : -1;
  }

  // ---- inputs ----------------------------------------------------------------------------------------------------

  /** The query layer has a snapshot for `paramsKey` (first chunk included). */
  offer(page: SnapshotPage, paramsKey: string): void {
    const shown = this.shown;
    if (!shown) {
      this.shown = fromPage(page, paramsKey);
      this.ensureVisible();
      this.emit();
      return;
    }
    if (page.snapshotId === shown.snapshotId) {
      if (this.next) {
        this.next = null;
        this.emit();
      }
      return;
    }
    if (this.next?.snapshotId === page.snapshotId) return;
    this.consider(fromPage(page, paramsKey));
  }

  private consider(candidate: ShownSnapshot): void {
    const shown = this.shown as ShownSnapshot;
    if (this.selectionHold) {
      this.next = candidate;
      this.emit();
      return;
    }
    if (candidate.paramsKey !== shown.paramsKey) {
      this.authorFrozen = false;
      this.authorEdited.clear();
      this.next = null;
      this.shown = candidate;
      this.ensureVisible();
      this.emit();
      return;
    }
    if (this.authorFrozen && sameRowsExceptEdited(shown, candidate, this.authorEdited)) {
      this.next = candidate;
      return;
    }
    this.swapWhenReady(candidate);
  }

  private swapWhenReady(candidate: ShownSnapshot): void {
    this.next = candidate;
    const chunks = this.chunksFor(candidate, this.visible);
    const missing = chunks.filter((c) => !candidate.loaded.has(c));
    if (missing.length === 0) {
      this.apply(candidate);
      return;
    }
    Promise.all(missing.map((c) => this.loadChunk(candidate, c))).then(() => {
      if (this.next === candidate && !this.selectionHold) this.apply(candidate);
    });
  }

  private apply(candidate: ShownSnapshot): void {
    this.shown = candidate;
    this.next = null;
    this.ensureVisible();
    this.emit();
  }

  /** Rows [start, end] (inclusive, overscan included) are on screen. */
  setVisible(start: number, end: number): void {
    if (this.visible[0] === start && this.visible[1] === end) return;
    this.visible = [start, end];
    this.ensureVisible();
  }

  setSelectionHold(on: boolean): void {
    if (this.selectionHold === on) return;
    this.selectionHold = on;
    if (!on && this.next) {
      const candidate = this.next;
      this.next = null;
      this.consider(candidate);
    }
    this.emit();
  }

  /** This tab committed a value on `recordId`: keep the row order until refresh. */
  noteAuthorEdit(recordId: string): void {
    this.authorFrozen = true;
    this.authorEdited.add(recordId);
  }

  /** Show the newest snapshot (after bulk deletes and creates, or "refresh"). */
  resume(): void {
    this.authorFrozen = false;
    this.authorEdited.clear();
    if (this.next && !this.selectionHold) {
      const candidate = this.next;
      this.next = null;
      this.consider(candidate);
    }
  }

  // ---- chunks ------------------------------------------------------------------------------------------------------

  private chunksFor(s: ShownSnapshot, [start, end]: [number, number]): number[] {
    if (s.total === 0) return [];
    const last = Math.min(end, s.total - 1);
    const out: number[] = [];
    for (let c = Math.floor(Math.max(0, start) / CHUNK_SIZE); c <= Math.floor(last / CHUNK_SIZE); c++) out.push(c);
    return out;
  }

  private ensureVisible(): void {
    const shown = this.shown;
    if (!shown) return;
    for (const c of this.chunksFor(shown, this.visible)) {
      if (!shown.loaded.has(c)) void this.loadChunk(shown, c);
    }
  }

  private loadChunk(s: ShownSnapshot, chunk: number): Promise<void> {
    const existing = s.loading.get(chunk);
    if (existing) return existing;
    const start = chunk * CHUNK_SIZE;
    const promise = this.fetchChunk(s.snapshotId, start).then(
      (page) => {
        s.loading.delete(chunk);
        s.failed.delete(chunk);
        for (let i = 0; i < page.ids.length; i++) s.ids[start + i] = page.ids[i];
        s.loaded.add(chunk);
        if (!this.disposed && s === this.shown) this.emit();
      },
      (error: unknown) => {
        s.loading.delete(chunk);
        s.failed.add(chunk);
        if (!this.disposed && s === this.shown && isExpired(error)) this.onExpired();
      },
    );
    s.loading.set(chunk, promise);
    return promise;
  }
}

function isExpired(error: unknown): boolean {
  const shape = (error as { shape?: { additional_information?: { code?: string } } } | null)?.shape;
  const message = error instanceof Error ? error.message : '';
  return shape?.additional_information?.code === 'SNAPSHOT_NOT_FOUND' || /snapshot/i.test(message);
}
