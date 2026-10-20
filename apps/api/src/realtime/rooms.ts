// Room channels (I4b): presence + ephemeral fan-out, in memory only, never persisted.
import type { PresenceMember, ServerToClient } from '@agentic-crm/realtime';

export interface RoomPeer {
  /** Connection id (one per tab). */
  readonly id: string;
  readonly userId: string;
  /** `<userId>.<connectionId>` (CROSS-DOMAIN X-04). */
  readonly clientId: string;
  send(message: ServerToClient): void;
}

interface Occupant {
  peer: RoomPeer;
  state: Record<string, unknown>;
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Map<string, Occupant>>();

  get size(): number {
    return this.rooms.size;
  }

  has(room: string, peer: RoomPeer): boolean {
    return this.rooms.get(room)?.has(peer.id) ?? false;
  }

  members(room: string): PresenceMember[] {
    const occupants = this.rooms.get(room);
    if (!occupants) return [];
    return [...occupants.values()].map(({ peer, state }) => ({ userId: peer.userId, clientId: peer.clientId, state }));
  }

  /** Enter (or re-enter with a new state); everyone in the room, the joiner included, gets the member list. */
  join(room: string, peer: RoomPeer, state: Record<string, unknown> = {}): void {
    let occupants = this.rooms.get(room);
    if (!occupants) {
      occupants = new Map();
      this.rooms.set(room, occupants);
    }
    occupants.set(peer.id, { peer, state });
    this.broadcastPresence(room);
  }

  leave(room: string, peer: RoomPeer): boolean {
    const occupants = this.rooms.get(room);
    if (!occupants?.delete(peer.id)) return false;
    if (occupants.size === 0) this.rooms.delete(room);
    else this.broadcastPresence(room);
    return true;
  }

  setState(room: string, peer: RoomPeer, state: Record<string, unknown>): boolean {
    const occupant = this.rooms.get(room)?.get(peer.id);
    if (!occupant) return false;
    occupant.state = state;
    this.broadcastPresence(room);
    return true;
  }

  /** Fan-out to the other occupants; the sender gets no echo (Ably `echoMessages:false`, realtime.md §1). */
  publish(room: string, peer: RoomPeer, payload: Record<string, unknown>): boolean {
    const occupants = this.rooms.get(room);
    if (!occupants?.has(peer.id)) return false;
    const message: ServerToClient = { type: 'ephemeral', room, from: peer.userId, clientId: peer.clientId, payload };
    for (const { peer: other } of occupants.values()) {
      if (other.id !== peer.id) other.send(message);
    }
    return true;
  }

  /**
   * Server-originated ephemeral fan-out to every occupant (slice 10: Ask Agentic stream events in
   * `thread:<ws>:<threadId>`); `from` is "server". Returns how many occupants received it.
   */
  broadcast(room: string, payload: Record<string, unknown>): number {
    const occupants = this.rooms.get(room);
    if (!occupants) return 0;
    const message: ServerToClient = { type: 'ephemeral', room, from: 'server', payload };
    for (const { peer } of occupants.values()) peer.send(message);
    return occupants.size;
  }

  private broadcastPresence(room: string): void {
    const occupants = this.rooms.get(room);
    if (!occupants) return;
    const message: ServerToClient = { type: 'presence', room, members: this.members(room) };
    for (const { peer } of occupants.values()) peer.send(message);
  }
}
