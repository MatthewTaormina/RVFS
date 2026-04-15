/**
 * §9.10 Health Check — GET /ping
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { makeServer } from '../setup.js'

describe('GET /ping', () => {
  let app: FastifyInstance

  beforeEach(() => {
    app = makeServer()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 200 with { ok: true, version: string }', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.version).toBe('string')
    expect(body.version.length).toBeGreaterThan(0)
  })

  it('requires no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' })
    // Must not be 401 — /ping is always public
    expect(res.statusCode).not.toBe(401)
  })

  it('returns application/json content-type', async () => {
    const res = await app.inject({ method: 'GET', url: '/ping' })
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })
})
