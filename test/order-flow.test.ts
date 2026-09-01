import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DataType, newDb } from 'pg-mem'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { OrderService } from '../src/domain/order-service.js'
import type { Identity } from '../src/domain/types.js'

const identity: Identity = {
  userId: 'user-1', projectId: 'project-1', requestId: 'request-1', roles: ['member'], tools: ['*'],
}

describe('durable quotation and order flow', () => {
  let pool: pg.Pool
  let service: OrderService

  beforeEach(async () => {
    const db = newDb()
    db.registerExtension('pgcrypto', (schema) => {
      schema.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: randomUUID, impure: true })
    })
    const adapter = db.adapters.createPg()
    pool = new adapter.Pool() as unknown as pg.Pool
    const schema = await readFile(fileURLToPath(new URL('../src/db/schema.sql', import.meta.url)), 'utf8')
    await pool.query(schema)
    const clock = new Date()
    service = new OrderService(pool, () => clock)
  })

  afterEach(async () => pool.end())

  it('requires human confirmation and returns one order for an identical retry', async () => {
    const quote = await service.prepareQuotation(identity, 'canteen-sim', 'pickup', [{ menuItemId: 'canteen-adobo', quantity: 2 }])
    expect(quote.totalMinor).toBe(33000)
    const pending = await service.requestOrderApproval(identity, quote.id)

    await expect(service.placeOrder(identity, pending.approvalId, 'retry-key-123')).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await service.confirmOrderApproval(identity, pending.approvalId, quote.quoteHash, true)
    const first = await service.placeOrder(identity, pending.approvalId, 'retry-key-123')
    const retry = await service.placeOrder(identity, pending.approvalId, 'retry-key-123')
    expect(retry.id).toBe(first.id)

    const count = await pool.query('SELECT count(*)::int AS count FROM orders')
    expect(count.rows[0].count).toBe(1)
  })

  it('does not allow one user to read another user\'s order', async () => {
    const quote = await service.prepareQuotation(identity, 'bento-sim', 'pickup', [{ menuItemId: 'bento-tofu', quantity: 1 }])
    const pending = await service.requestOrderApproval(identity, quote.id)
    await service.confirmOrderApproval(identity, pending.approvalId, quote.quoteHash, true)
    const order = await service.placeOrder(identity, pending.approvalId, 'isolation-key-1')
    await expect(service.getOrderStatus({ ...identity, userId: 'user-2' }, order.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
