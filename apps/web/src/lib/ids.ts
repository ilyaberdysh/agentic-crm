// Client-minted ids for UI creates (ARCHITECTURE I3): UUIDv7, time-ordered.
import { v7 } from 'uuid';

export function newId(): string {
  return v7();
}
