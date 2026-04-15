import type { MetaNode, RootMetaNode } from './meta.js';
import type { BlobHeader } from './blob.js';
import type { Session } from './session.js';

/**
 * §9.9 Storage Backend Interface
 *
 * Implementations MUST satisfy this interface. The HTTP layer (Fastify routes)
 * is coupled ONLY to this interface — never to a concrete storage backend.
 *
 * All methods are async. Implementations MUST be safe for concurrent async calls.
 */
export interface StorageBackend {
  // ── Meta nodes ────────────────────────────────────────────────────────────

  /** Fetch a meta node by ID; returns null if not found. */
  getMeta(nid: string): Promise<MetaNode | null>;

  /** Create or fully replace a meta node. */
  putMeta(node: MetaNode): Promise<void>;

  /**
   * Partially update a meta node.
   * Returns the updated node after applying the patch.
   */
  patchMeta(nid: string, patch: Partial<MetaNode>): Promise<MetaNode>;

  /** Delete a meta node by ID. */
  deleteMeta(nid: string): Promise<void>;

  // ── Blob nodes ────────────────────────────────────────────────────────────

  /** Fetch blob header metadata; returns null if not found. */
  getBlobHeader(nid: string): Promise<BlobHeader | null>;

  /** Fetch raw blob content; returns null if not found. */
  getBlob(nid: string): Promise<ArrayBuffer | null>;

  /**
   * Store a blob.
   * @returns The nid assigned to the stored blob.
   */
  putBlob(header: BlobHeader, content: ArrayBuffer): Promise<string>;

  /** Delete a blob by ID. Callers MUST ensure ref_count === 0 first. */
  deleteBlob(nid: string): Promise<void>;

  // ── Filesystem root ───────────────────────────────────────────────────────

  /** Fetch the root meta node (fs.meta) for a filesystem; null if not found. */
  getFS(fsid: string): Promise<RootMetaNode | null>;

  /** Create or replace the root meta node for a filesystem. */
  putFS(root: RootMetaNode): Promise<void>;

  /**
   * Delete a filesystem and all nodes owned by it.
   * The implementation MUST cascade-delete all meta and blob nodes owned by this fsid.
   */
  deleteFS(fsid: string): Promise<void>;

  /**
   * List all node IDs belonging to a filesystem (paginated).
   * @param cursor - Opaque pagination cursor from a previous call; omit for first page.
   * @param limit  - Maximum number of nids to return.
   */
  listFSNodes(
    fsid:    string,
    cursor?: string,
    limit?:  number,
  ): Promise<{ nids: string[]; cursor: string | null }>;

  // ── Sessions ──────────────────────────────────────────────────────────────

  /** Fetch a session by ID; returns null if not found or expired. */
  getSession(sessionId: string): Promise<Session | null>;

  /** Create or replace a session record. */
  putSession(session: Session): Promise<void>;

  /** Delete (revoke) a session by ID. */
  deleteSession(sessionId: string): Promise<void>;

  // ── GC helpers ────────────────────────────────────────────────────────────

  /**
   * Return node IDs whose effective TTL expired before `before`.
   * Used by the server's garbage collection sweep.
   */
  listExpiredNodes(before: Date): Promise<string[]>;

  /**
   * Return filesystem IDs whose effective TTL expired before `before`.
   * Used by the server's garbage collection sweep.
   */
  listExpiredFS(before: Date): Promise<string[]>;
}

