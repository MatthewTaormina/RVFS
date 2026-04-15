/**
 * §5.1 POSIX permission check unit tests.
 *
 * Tests import `checkPermission` directly from the permissions module
 * (not via HTTP) to validate the permission algorithm in isolation.
 *
 * Expected function signature:
 *   checkPermission(
 *     mode:       number,   // Unix permission bits (e.g. 0o644)
 *     fileUid:    number,   // owner uid of the file/dir
 *     fileGid:    number,   // owner gid of the file/dir
 *     callerUid:  number,   // uid of the requesting user
 *     callerGid:  number,   // gid of the requesting user
 *     operation:  'read' | 'write' | 'execute',
 *   ): boolean
 *
 * Bit layout (§5.1):
 *   For uid match: relevant = (mode >> 6) & 7
 *   For gid match: relevant = (mode >> 3) & 7
 *   For other:     relevant = mode & 7
 *   read    bit: 4 (0b100)
 *   write   bit: 2 (0b010)
 *   execute bit: 1 (0b001)
 */

import { describe, it, expect } from 'vitest'
// @ts-ignore — stub until Alex implements
import { checkPermission } from '../src/permissions.js'

const OWNER_UID = 1000
const OWNER_GID = 1000
const OTHER_UID = 9999
const OTHER_GID = 9999

describe('checkPermission — 0o644 regular file', () => {
  //  Owner: rw-  (6 = 110)
  //  Group: r--  (4 = 100)
  //  Other: r--  (4 = 100)
  const MODE = 0o644

  it('owner: read allowed', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OWNER_UID, OWNER_GID, 'read')).toBe(true)
  })

  it('owner: write allowed', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OWNER_UID, OWNER_GID, 'write')).toBe(true)
  })

  it('owner: execute denied', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OWNER_UID, OWNER_GID, 'execute')).toBe(false)
  })

  it('other (no uid/gid match): read allowed via other-read bit', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'read')).toBe(true)
  })

  it('other: write denied', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'write')).toBe(false)
  })

  it('other: execute denied', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'execute')).toBe(false)
  })
})

describe('checkPermission — 0o755 directory', () => {
  //  Owner: rwx  (7 = 111)
  //  Group: r-x  (5 = 101)
  //  Other: r-x  (5 = 101)
  const MODE = 0o755

  it('owner: all permitted', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OWNER_UID, OWNER_GID, 'read')).toBe(true)
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OWNER_UID, OWNER_GID, 'write')).toBe(true)
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OWNER_UID, OWNER_GID, 'execute')).toBe(true)
  })

  it('other: traverse (execute) allowed — required for directory traversal (§5.1)', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'execute')).toBe(true)
  })

  it('other: read allowed', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'read')).toBe(true)
  })

  it('other: write denied', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'write')).toBe(false)
  })
})

describe('checkPermission — 0o700 directory (owner-only)', () => {
  //  Owner: rwx  (7)
  //  Group: ---  (0)
  //  Other: ---  (0)
  const MODE = 0o700

  it('owner: all permitted', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OWNER_UID, OWNER_GID, 'read')).toBe(true)
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OWNER_UID, OWNER_GID, 'write')).toBe(true)
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OWNER_UID, OWNER_GID, 'execute')).toBe(true)
  })

  it('uid mismatch: traverse denied (§5.1)', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'execute')).toBe(false)
  })

  it('uid mismatch: read denied', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'read')).toBe(false)
  })

  it('uid mismatch: write denied', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'write')).toBe(false)
  })
})

describe('checkPermission — 0o000 (all denied)', () => {
  const MODE = 0o000

  it('owner: read denied', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OWNER_UID, OWNER_GID, 'read')).toBe(false)
  })

  it('owner: write denied', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OWNER_UID, OWNER_GID, 'write')).toBe(false)
  })

  it('owner: execute denied', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OWNER_UID, OWNER_GID, 'execute')).toBe(false)
  })

  it('other: all denied', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'read')).toBe(false)
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'write')).toBe(false)
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'execute')).toBe(false)
  })
})

describe('checkPermission — group matching (§5.1)', () => {
  //  0o640: Owner: rw-, Group: r--, Other: ---
  const MODE = 0o640
  const GROUP_MEMBER_UID = 5555  // different uid but same gid as owner

  it('group member: read allowed via group-read bit', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, GROUP_MEMBER_UID, OWNER_GID, 'read')).toBe(true)
  })

  it('group member: write denied (group has no write bit)', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, GROUP_MEMBER_UID, OWNER_GID, 'write')).toBe(false)
  })

  it('non-member other: read denied (other bits are 0)', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'read')).toBe(false)
  })
})

describe('checkPermission — 0o777 symlink (§5.2)', () => {
  // Symlinks default to 0o777 — all operations permitted
  const MODE = 0o777

  it('all callers can read', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'read')).toBe(true)
  })

  it('all callers can write', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'write')).toBe(true)
  })

  it('all callers can execute/traverse', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, OTHER_UID, OTHER_GID, 'execute')).toBe(true)
  })
})

describe('checkPermission — root user (uid 0, §5.1)', () => {
  // Root (uid 0) bypasses all permission checks
  const ROOT_UID = 0
  const ROOT_GID = 0
  const MODE = 0o000

  it('root can read a 0o000 file', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, ROOT_UID, ROOT_GID, 'read')).toBe(true)
  })

  it('root can write a 0o000 file', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, ROOT_UID, ROOT_GID, 'write')).toBe(true)
  })

  it('root can execute a 0o000 file', () => {
    expect(checkPermission(MODE, OWNER_UID, OWNER_GID, ROOT_UID, ROOT_GID, 'execute')).toBe(true)
  })
})
