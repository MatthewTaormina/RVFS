/**
 * §6 Sessions
 */

/** The access level a session holds over a specific filesystem. */
export type SessionAccess = 'read' | 'write' | 'admin';

/** A single filesystem entry in a session's access list. */
export interface SessionFilesystem {
  fsid:   string;
  access: SessionAccess;
}

/** Lifecycle state of a session (§6.4). */
export type SessionStatus = 'active' | 'expired' | 'revoked';

/**
 * Session object (§6.1).
 * The session_id doubles as the bearer token for API authentication.
 */
export interface Session {
  /** Opaque token — UUID v4. Used as Authorization: Bearer value. */
  session_id:  string;
  /** 'guest' for anonymous sessions; a user ID string for authenticated ones. */
  identity:    'guest' | string;
  /** ISO-8601 */
  created_at:  string;
  /** ISO-8601 */
  expires_at:  string;
  ttl_seconds: number;
  filesystems: SessionFilesystem[];
  /** Arbitrary key/value store for host application context. */
  metadata:    Record<string, unknown>;
}

