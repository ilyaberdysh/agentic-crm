// The stale-response guard of record search (command-palette.md §5; slice5-contracts "Search ranking & debounce"):
// the client fires a request on every keystroke, tags each with a monotonically increasing `requestSeq`, and drops
// any response older than the newest one it has applied. A module-level counter keeps sequence numbers unique
// across every search box of the tab, so two boxes can never confuse each other's responses.

let counter = 0;

/** The next request sequence number of this tab. */
export function nextRequestSeq(): number {
  counter += 1;
  return counter;
}

/** One per search box: accepts a response only when it is at least as new as the newest applied one. */
export class SearchGuard {
  private applied = 0;

  /** True (and remembered) when `seq` is not older than the newest applied response. */
  accept(seq: number): boolean {
    if (seq < this.applied) return false;
    this.applied = seq;
    return true;
  }

  get appliedSeq(): number {
    return this.applied;
  }
}
