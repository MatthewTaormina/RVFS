/**
 * §5 Linux Metadata & Permissions
 * Stored on every directory and file meta node.
 */
export interface LinuxMeta {
  /** Unix permission bits (e.g. 0o755 stored as decimal 493) */
  mode:  number;
  /** Numeric user ID (0 = root, 1000 = default learner) */
  uid:   number;
  /** Numeric group ID */
  gid:   number;
  /** Last access time — ISO-8601 */
  atime: string;
  /** Last content modification time — ISO-8601 */
  mtime: string;
  /** Last metadata change time — ISO-8601 */
  ctime: string;
  /** Number of hard links (always >= 1) */
  nlink: number;
  /**
   * Virtual inode number — lower 53 bits of the SHA-256 of the node's nid.
   * Stable within a session; unique within a filesystem.
   */
  inode: number;
}

/**
 * §3.1.1 Root Meta Node — the entry point of a filesystem (fs.meta).
 */
export interface RootMetaNode {
  nid:        string;
  type:       'root';
  fsid:       string;
  label:      string;
  /** ISO-8601 */
  created_at: string;
  /** ISO-8601 */
  updated_at: string;
  /** Seconds until eligible for server expiry; null = forever */
  ttl:        number | null;
  owner:      string;
  /** fsid of the parent filesystem if this is a fork; null otherwise */
  fork_of:    string | null;
  /** 0 for an original filesystem; increments per fork level */
  fork_depth: number;
  /** nids of top-level directory and file meta nodes */
  children:   string[];
  /** name → nid map for O(1) child lookup; kept in sync with children */
  name_index: Record<string, string>;
}

/**
 * §3.1.2 Directory Meta Node.
 */
export interface DirMetaNode {
  nid:        string;
  type:       'dir';
  /** Entry name in its parent (e.g. 'home') */
  name:       string;
  /** null only for items directly under root */
  parent_nid: string | null;
  fsid:       string;
  /** ISO-8601 */
  created_at: string;
  /** ISO-8601 */
  updated_at: string;
  /** Seconds until eligible for server expiry; null = forever */
  ttl:        number | null;
  meta:       LinuxMeta;
  /** nids of contained directory and file meta nodes */
  children:   string[];
  /** name → nid map for O(1) child lookup; kept in sync with children */
  name_index: Record<string, string>;
}

/**
 * §3.1.3 File Meta Node.
 */
export interface FileMetaNode {
  nid:            string;
  type:           'file';
  name:           string;
  /** null only for items directly under root */
  parent_nid:     string | null;
  fsid:           string;
  /** ISO-8601 */
  created_at:     string;
  /** ISO-8601 */
  updated_at:     string;
  /** Seconds until eligible for server expiry; null = forever */
  ttl:            number | null;
  meta:           LinuxMeta;
  /** null for empty files or symlinks */
  blob_nid:       string | null;
  /** Byte count of blob content */
  size:           number;
  /** Absolute VFS path for symlinks; mutually exclusive with blob_nid */
  symlink_target: string | null;
}

/**
 * Union of all three meta node sub-types (§3.1).
 * Discriminated via the `type` field.
 */
export type MetaNode = RootMetaNode | DirMetaNode | FileMetaNode;

