import { v7 } from 'uuid';

/** Server-minted UUIDv7 (time-ordered). Client creates send their own id (I3). */
export function newId(): string {
  return v7();
}
