/**
 * §13 Error Model
 *
 * All errors thrown by the client library and server operation handlers
 * are instances of RvfsError.
 */

/**
 * Union of all valid RVFS error codes.
 *
 * Standard POSIX codes:
 * - ENOENT, EEXIST, EACCES, EPERM, ENOTDIR, EISDIR, ENOTEMPTY, ELOOP,
 *   ENAMETOOLONG, EXDEV, ENOSPC, EBADF, EINVAL, EIO, ENOSYS
 *
 * RVFS-specific codes (§13):
 * - ENOTIMPL — feature not yet implemented (V2 stubs; maps to HTTP 501)
 * - OFFLINE   — remote unavailable and no cache entry
 * - EXPIRED   — node or filesystem has hard-expired
 * - FORBIDDEN — session lacks access to this filesystem
 * - CONFLICT  — WAL replay conflict during sync
 * - ELOCKED   — path is locked by another session (§15)
 * - EDEADLOCK — lock acquisition would create a cycle (§15.6)
 * - TIMEOUT   — remote request timed out (also used for HTTP 429)
 */
export type RvfsErrorCode =
  | 'ENOENT'
  | 'EEXIST'
  | 'EACCES'
  | 'EPERM'
  | 'ENOTDIR'
  | 'EISDIR'
  | 'ENOTEMPTY'
  | 'ELOOP'
  | 'ENAMETOOLONG'
  | 'EXDEV'
  | 'ENOSPC'
  | 'EBADF'
  | 'EINVAL'
  | 'EIO'
  | 'ENOSYS'
  | 'ENOTIMPL'
  | 'OFFLINE'
  | 'EXPIRED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'ELOCKED'
  | 'EDEADLOCK'
  | 'TIMEOUT';

/**
 * The single error class thrown by all RVFS client and server operation code.
 *
 * @example
 * throw new RvfsError('ENOENT', 'File not found', { path: '/home/learner/foo.txt' });
 */
export class RvfsError extends Error {
  readonly code:    RvfsErrorCode;
  readonly path?:   string;
  readonly nid?:    string;
  /** HTTP status code from the server, if applicable. */
  readonly status?: number;

  constructor(
    code:     RvfsErrorCode,
    message:  string,
    options?: { path?: string; nid?: string; status?: number },
  ) {
    super(message);
    this.name   = 'RvfsError';
    this.code   = code;
    if (options?.path   !== undefined) this.path   = options.path;
    if (options?.nid    !== undefined) this.nid    = options.nid;
    if (options?.status !== undefined) this.status = options.status;
    // Ensure correct prototype chain in transpiled ES5 environments.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

