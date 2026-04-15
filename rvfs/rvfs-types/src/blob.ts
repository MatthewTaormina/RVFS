/**
 * §3.2 Blob Header — JSON side-channel metadata for a raw binary blob node.
 */
export interface BlobHeader {
  nid:        string;
  type:       'blob';
  fsid:       string;
  /** Byte count of blob content */
  size:       number;
  /** IANA media type, e.g. 'text/plain; charset=utf-8' */
  mime_type:  string;
  /** Hex-encoded SHA-256 of content, for integrity checks */
  sha256:     string;
  /** ISO-8601 */
  created_at: string;
  /** Seconds until eligible for server expiry; null = forever */
  ttl:        number | null;
  /**
   * Number of file meta nodes pointing to this blob.
   * Used for copy-on-write reference tracking and GC.
   */
  ref_count:  number;
}

