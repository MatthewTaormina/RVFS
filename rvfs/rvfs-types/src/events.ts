import type { LinuxMeta } from './meta.js';

/**
 * §9.7 Change Stream — the full set of SSE event type strings.
 *
 * NOTE: The spec uses prefixed names ('node:write') on the wire (§9.7)
 * which differ from the abbreviated names in the §10.8 client-side
 * RvfsChangeEvent.type. This package uses the §9.7 wire names as the
 * canonical event type discriminant.
 */
export type RvfsChangeEventType =
  | 'node:create'
  | 'node:write'
  | 'node:meta'
  | 'node:delete'
  | 'node:move'
  | 'fs:fork'
  | 'fs:delete'
  | 'session:expire'
  | 'stream:reset';

/**
 * §9.7 Change Event Payload — the common envelope shared by all SSE events.
 *
 * The server emits this shape; clients receive it via the SSE stream and
 * pass it (possibly enriched with a `local` flag by the client library)
 * to application-level `watch()` / `watchPath()` handlers.
 *
 * ⚠ Spec ambiguity (§9.7 vs §10.8):
 *   §9.7 defines `at` as an ISO-8601 string and has no `local` field.
 *   §10.8 sketches a simplified client-side shape with `at: Date` and
 *   `local: boolean`. This interface uses the §9.7 wire format; client
 *   implementations are responsible for deserialising `at` and injecting
 *   `local` before dispatching to handlers.
 */
export interface RvfsChangeEvent {
  /** Unique ID for deduplication — UUID v4. */
  event_id:   string;
  event:      RvfsChangeEventType;
  fsid:       string;
  /** Affected node; null for filesystem-level events (fs:fork, fs:delete). */
  nid:        string | null;
  /** Resolved VFS path at time of change; null for session/stream events. */
  path:       string | null;
  /** Previous path — only present (non-null) for node:move. */
  old_path:   string | null;
  /** Session that caused the mutation. */
  session_id: string;
  /** Server-side timestamp of the mutation — ISO-8601. */
  at:         string;
  /** Partial LinuxMeta for node:meta events; null for all others. */
  meta_delta: Partial<LinuxMeta> | null;
}

