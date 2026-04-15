import type { FileMetaNode, DirMetaNode } from './meta.js';
import type { RvfsChangeEvent } from './events.js';
import type { RvfsError } from './error.js';

/**
 * §10.4 Write options accepted by writeText() and writeBinary().
 * These flags map to the op/write server endpoint (§9.4).
 */
export interface WriteOptions {
  /** Unix permission bits for a newly-created file. Default: 0o644. */
  mode?:          number;
  /** Create any missing parent directories. Default: false. */
  createParents?: boolean;
  /** Fail if the file already exists (no-clobber). Default: false. */
  noClobber?:     boolean;
  /** Node TTL in seconds. Inherits the filesystem TTL if unset. */
  ttl?:           number;
}

/** In-memory read cache statistics (§10.6, §11.1). */
export interface CacheStats {
  hits:          number;
  misses:        number;
  evictions:     number;
  /** Number of meta nodes currently held in cache. */
  sizeNodes:     number;
  /** Total byte size of blob data currently held in cache. */
  sizeBlobBytes: number;
}

/** Result returned by sync() after WAL replay (§10.9, §12.3). */
export interface SyncResult {
  /** Number of WAL entries successfully replayed against the remote. */
  applied:   number;
  /** Number of entries that landed in 'conflict' status. */
  conflicts: number;
  /** Number of entries that landed in 'error' status. */
  errors:    number;
  /** Entries already in 'done' status — skipped as idempotent. */
  skipped:   number;
}

/**
 * A single WAL entry as returned by getPendingWrites() (§10.9, §12.1).
 */
export interface PendingWrite {
  id:        string;
  fsid:      string;
  op:        'create' | 'write' | 'rm' | 'mv' | 'cp' | 'mkdir' | 'rmdir' | 'chmod' | 'chown';
  path:      string;
  /** Operation-specific payload — mirrors the corresponding op endpoint body (§9.4). */
  args:      Record<string, unknown>;
  queued_at: Date;
  status:    'pending' | 'syncing' | 'done' | 'conflict' | 'error';
  /** Retry attempt count. */
  retry:     number;
  /** Error message if status is 'error'; null otherwise. */
  error:     string | null;
}

/**
 * String literal union of all lifecycle events the client emits via on() (§10.9).
 */
export type RvfsClientEvent =
  | 'online'
  | 'offline'
  | 'sync:start'
  | 'sync:complete'
  | 'sync:error'
  | 'change';

/**
 * Discriminated union of all event payloads passed to on() handlers (§10.9).
 */
export type RvfsEvent =
  | { type: 'online' }
  | { type: 'offline' }
  | { type: 'sync:start' }
  | { type: 'sync:complete'; result: SyncResult }
  | { type: 'sync:error';    entry: PendingWrite; error: RvfsError }
  | { type: 'change';        event: RvfsChangeEvent };

/**
 * §15.4 Lock object shape, as returned by queryLocks() or held in the
 * blocking_locks list of a 409 response.
 *
 * NOTE: This is a V2 feature (§18). The client interface includes LockInfo
 * as a peer type so host applications can handle lock-conflict responses
 * without depending on the V2 lock API.
 */
export type LockInfo = {
  lock_id:     string;
  fsid:        string;
  path:        string;
  type:        'shared' | 'exclusive' | 'intent-shared' | 'intent-exclusive';
  mode:        'advisory' | 'mandatory';
  session_id:  string;
  acquired_at: Date;
  expires_at:  Date;
  /** TTL in seconds from acquisition time. Max 300 per §14.7. */
  ttl:         number;
  recursive:   boolean;
  metadata:    Record<string, unknown>;
};

/**
 * §10.1 Base configuration accepted by all concrete client implementations.
 */
export interface RvfsClientConfig {
  // ── Remote ────────────────────────────────────────────────────────────────
  /** e.g. 'https://api.example.com/rvfs/v1' */
  baseUrl:          string;
  /** Bearer token. Omit to let the server assign a guest session. */
  sessionId?:       string;
  fsid:             string;

  // ── Cache ─────────────────────────────────────────────────────────────────
  /** Maximum number of meta nodes in the LRU cache. Default: 256. */
  cacheMaxNodes?:   number;
  /** Maximum total blob data in the in-memory cache (MB). Default: 32. */
  cacheMaxBlobMb?:  number;

  // ── Offline & sync ────────────────────────────────────────────────────────
  /** Queue writes to the WAL when offline. Default: true. */
  offlineFallback?: boolean;
  /** Automatically replay the WAL on reconnect. Default: true. */
  syncOnReconnect?: boolean;
  /** How to resolve WAL replay conflicts. Default: 'fail'. */
  conflictPolicy?:  'overwrite' | 'fail';

  // ── Change stream ─────────────────────────────────────────────────────────
  /** Automatically open the SSE watch stream on mount(). Default: true. */
  watchOnMount?:    boolean;
  /** Glob filters forwarded to /watch (§9.7). Default: ['/**']. */
  watchPaths?:      string[];
}

/**
 * §10.0 Shared client interface implemented by all environment-specific clients.
 *
 * All methods throw RvfsError on failure.
 */
export interface IRvfsClient {
  // ── Lifecycle ─────────────────────────────────────────────────────────────
  /** Connect to the remote, warm the cache, and open the SSE stream. */
  mount(): Promise<void>;
  /** Flush pending WAL entries, close the SSE stream, and release resources. */
  unmount(): Promise<void>;

  // ── Read ──────────────────────────────────────────────────────────────────
  stat(path: string): Promise<FileMetaNode | DirMetaNode>;
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  readdir(path: string): Promise<string[]>;
  readdirWithTypes(path: string): Promise<Array<{ name: string; stat: FileMetaNode | DirMetaNode }>>;
  realpath(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  isFile(path: string): Promise<boolean>;
  isDir(path: string): Promise<boolean>;

  // ── Write ─────────────────────────────────────────────────────────────────
  writeText(path: string, content: string, options?: WriteOptions): Promise<void>;
  writeBinary(path: string, content: Uint8Array, options?: WriteOptions): Promise<void>;
  appendText(path: string, content: string): Promise<void>;

  // ── Directory ─────────────────────────────────────────────────────────────
  mkdir(path: string, options?: { parents?: boolean; mode?: number }): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  // ── File management ───────────────────────────────────────────────────────
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  mv(src: string, dst: string): Promise<void>;
  cp(src: string, dst: string, options?: { recursive?: boolean }): Promise<void>;
  symlink(target: string, path: string): Promise<void>;

  // ── Metadata ──────────────────────────────────────────────────────────────
  chmod(path: string, mode: number): Promise<void>;
  chown(path: string, uid: number, gid: number): Promise<void>;
  utimes(path: string, atime: Date, mtime: Date): Promise<void>;

  // ── Forking ───────────────────────────────────────────────────────────────
  /** Fork the mounted filesystem; returns a new client bound to the fork's fsid. */
  fork(options?: { label?: string; ttl?: number }): Promise<IRvfsClient>;
  /** Returns true if the path exists in the current FS (not inherited from parent fork). */
  isOwned(path: string): Promise<boolean>;

  // ── Cache control ─────────────────────────────────────────────────────────
  invalidate(...paths: string[]): void;
  prefetch(dir: string, depth?: number): Promise<void>;
  cacheStats(): CacheStats;

  // ── Session ───────────────────────────────────────────────────────────────
  renewSession(ttlSeconds: number): Promise<void>;
  endSession(): Promise<void>;

  // ── Change stream ─────────────────────────────────────────────────────────
  /** Subscribe to all change events for the mounted filesystem. Returns an unsubscribe function. */
  watch(handler: (event: RvfsChangeEvent) => void): () => void;
  /** Subscribe to changes matching a single path or glob. Returns an unsubscribe function. */
  watchPath(pathOrGlob: string, handler: (event: RvfsChangeEvent) => void): () => void;

  // ── Offline & WAL ─────────────────────────────────────────────────────────
  readonly online: boolean;
  on(event: RvfsClientEvent, handler: (e: RvfsEvent) => void): void;
  sync(): Promise<SyncResult>;
  getPendingWrites(): Promise<PendingWrite[]>;
  discardPendingWrite(id: string): Promise<void>;
}

