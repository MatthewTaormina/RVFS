import type { RvfsErrorCode } from 'rvfs-types'

export class RvfsError extends Error {
  readonly code: RvfsErrorCode
  readonly path?: string
  readonly nid?: string
  readonly status?: number

  constructor(
    code: RvfsErrorCode,
    message: string,
    options?: { path?: string; nid?: string; status?: number },
  ) {
    super(message)
    this.name = 'RvfsError'
    this.code = code
    if (options?.path !== undefined) this.path = options.path
    if (options?.nid !== undefined) this.nid = options.nid
    if (options?.status !== undefined) this.status = options.status
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
