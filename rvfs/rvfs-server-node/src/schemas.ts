import { z } from 'zod'
import { RvfsError } from './errors.js'

// POST /session
export const CreateSessionSchema = z.object({
  identity: z.string().min(1),
  ttl_seconds: z.number().int().positive(),
  filesystems: z.array(z.object({ fsid: z.string(), access: z.string() })).optional(),
  metadata: z.record(z.unknown()).optional(),
})

// POST /fs
export const CreateFsSchema = z.object({
  label: z.string().optional(),
  ttl: z.number().nullable().optional(),
  owner: z.string().optional(),
})

// POST /fs/:fsid/fork
export const ForkFsSchema = z.object({
  label: z.string().optional(),
  ttl: z.number().nullable().optional(),
  owner: z.string().optional(),
})

// POST /fs/:fsid/op/create
export const OpCreateSchema = z.object({
  path: z.string().min(1),
  type: z.enum(['file', 'dir', 'symlink']),
  content: z.string().optional(),
  meta: z.object({ mode: z.number().optional(), uid: z.number().optional(), gid: z.number().optional() }).optional(),
  symlink_target: z.string().optional(),
})

// POST /fs/:fsid/op/write
export const OpWriteSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  create_if_missing: z.boolean().optional(),
  append: z.boolean().optional(),
})

// POST /fs/:fsid/op/read
export const OpReadSchema = z.object({
  path: z.string().min(1),
})

// POST /fs/:fsid/op/mv
export const OpMvSchema = z.object({
  src: z.string().min(1),
  dst: z.string().min(1),
})

// POST /fs/:fsid/op/cp
export const OpCpSchema = z.object({
  src: z.string().min(1),
  dst: z.string().min(1),
  recursive: z.boolean().optional(),
})

// POST /fs/:fsid/op/rm
export const OpRmSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional(),
})

// POST /batch
export const BatchSchema = z.object({
  requests: z.array(z.object({
    id: z.string(),
    method: z.string(),
    path: z.string(),
    body: z.unknown().optional(),
  })).max(100),
})

// PATCH /node/:nid
export const PatchNodeSchema = z.object({}).passthrough()

// PATCH /node/:nid/ttl
export const PatchNodeTtlSchema = z.object({
  ttl: z.number().nullable().optional(),
})

// DELETE /node/:nid (body optional, no schema needed)

// PATCH /session/:id/ttl
export const PatchSessionTtlSchema = z.object({
  ttl_seconds: z.number().int().positive(),
})

/**
 * Validate a Zod schema, throwing RvfsError on failure.
 */
export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const message = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new RvfsError('EINVAL', `Validation error: ${message}`, { status: 400 })
  }
  return result.data
}
