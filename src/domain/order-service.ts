import type pg from 'pg'
import { canonicalHash } from './hash.js'
import { errors } from './errors.js'
import type { BasketItemInput, Fulfilment, Identity, OrderState, Quote, QuotedItem } from './types.js'

const QUOTE_TTL_MS = 15 * 60 * 1000
const APPROVAL_TTL_MS = 5 * 60 * 1000
const CANCELLABLE: OrderState[] = ['placed', 'preparing']
const ADVANCE: Partial<Record<OrderState, OrderState>> = { placed: 'preparing', preparing: 'ready', ready: 'completed' }
const PAYMENT_TERMS = 'pay_on_delivery' as const

function rows<T>(result: pg.QueryResult): T[] { return result.rows as T[] }
function placeholders(count: number): string { return Array.from({ length: count }, (_, index) => `$${index + 1}`).join(',') }

export class OrderService {
  constructor(private readonly pool: pg.Pool) {}

  private async databaseNow(client: pg.Pool | pg.PoolClient = this.pool): Promise<Date> {
    const result = await client.query(`SELECT now() AS "now"`)
    return new Date(result.rows[0].now)
  }

  private requireTool(identity: Identity, tool: string): void {
    if (!identity.tools.includes(tool) && !identity.tools.includes('*')) throw errors.forbidden(`Delegation does not allow ${tool}`)
  }

  private async audit(client: pg.Pool | pg.PoolClient, identity: Identity, action: string, entityType: string, entityId: string | null, outcome: string, detail: Record<string, unknown> = {}): Promise<void> {
    await client.query(
      `INSERT INTO audit_events(request_id,user_id,project_id,action,entity_type,entity_id,outcome,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [identity.requestId, identity.userId, identity.projectId, action, entityType, entityId, outcome, JSON.stringify(detail)],
    )
  }

  async listOutlets(identity: Identity) {
    this.requireTool(identity, 'list_outlets')
    const result = await this.pool.query(`SELECT id,name FROM outlets WHERE active = true ORDER BY name`)
    return result.rows
  }

  async browseMenu(identity: Identity, outletId: string) {
    this.requireTool(identity, 'browse_menu')
    const result = await this.pool.query(
      `SELECT id,outlet_id AS "outletId",name,description,price_minor AS "priceMinor",currency,available FROM menu_items WHERE outlet_id=$1 ORDER BY name`,
      [outletId],
    )
    if (result.rowCount === 0) {
      const outlet = await this.pool.query(`SELECT 1 FROM outlets WHERE id=$1 AND active=true`, [outletId])
      if (outlet.rowCount === 0) throw errors.notFound('Outlet')
    }
    return result.rows
  }

  async checkAvailability(identity: Identity, menuItemIds: string[]) {
    this.requireTool(identity, 'check_availability')
    const result = await this.pool.query(`SELECT id,available FROM menu_items WHERE id IN (${placeholders(menuItemIds.length)})`, menuItemIds)
    const found = new Map(rows<{ id: string; available: boolean }>(result).map((row) => [row.id, row.available]))
    return menuItemIds.map((id) => ({ menuItemId: id, available: found.get(id) ?? false, found: found.has(id) }))
  }

  async prepareQuotation(identity: Identity, outletId: string, fulfilment: Fulfilment, basket: BasketItemInput[]): Promise<Quote> {
    this.requireTool(identity, 'prepare_quotation')
    if (basket.length === 0) throw errors.invalid('Basket must contain at least one item')
    if (new Set(basket.map((item) => item.menuItemId)).size !== basket.length) throw errors.invalid('Duplicate menu items must be combined')
    if (basket.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20)) throw errors.invalid('Each quantity must be between 1 and 20')

    const result = await this.pool.query(
      `SELECT id,name,price_minor AS "priceMinor",currency,available,outlet_id AS "outletId" FROM menu_items WHERE id IN (${placeholders(basket.length)})`,
      basket.map((item) => item.menuItemId),
    )
    const menu = new Map(rows<Record<string, unknown>>(result).map((row) => [String(row.id), {
      id: String(row.id), name: String(row.name), priceMinor: Number(row.priceMinor ?? row.priceminor ?? row.price_minor),
      currency: String(row.currency), available: Boolean(row.available), outletId: String(row.outletId ?? row.outletid ?? row.outlet_id),
    }]))
    const quotedItems: QuotedItem[] = basket.map((input) => {
      const item = menu.get(input.menuItemId)
      if (!item || item.outletId !== outletId) throw errors.invalid(`Menu item ${input.menuItemId} is not sold by this outlet`)
      if (!item.available) throw errors.conflict(`Menu item ${input.menuItemId} is unavailable`)
      return { menuItemId: item.id, name: item.name, quantity: input.quantity, unitPriceMinor: item.priceMinor, lineTotalMinor: item.priceMinor * input.quantity }
    })
    const totalMinor = quotedItems.reduce((sum, item) => sum + item.lineTotalMinor, 0)
    const databaseNow = await this.databaseNow()
    const expiresAt = new Date(databaseNow.getTime() + QUOTE_TTL_MS)
    const quoteHash = canonicalHash({ outletId, fulfilment, paymentTerms: PAYMENT_TERMS, currency: 'PHP', items: quotedItems, totalMinor, expiresAt: expiresAt.toISOString() })
    const inserted = await this.pool.query(
      `INSERT INTO quotes(user_id,project_id,outlet_id,fulfilment,currency,items,total_minor,quote_hash,expires_at)
       VALUES($1,$2,$3,$4,'PHP',$5,$6,$7,$8) RETURNING id`,
      [identity.userId, identity.projectId, outletId, fulfilment, JSON.stringify(quotedItems), totalMinor, quoteHash, expiresAt],
    )
    const id = String(inserted.rows[0].id)
    await this.audit(this.pool, identity, 'prepare_quotation', 'quote', id, 'success', { quoteHash, totalMinor })
    return { id, userId: identity.userId, projectId: identity.projectId, outletId, fulfilment, paymentTerms: PAYMENT_TERMS, currency: 'PHP', items: quotedItems, totalMinor, quoteHash, expiresAt }
  }

  async requestOrderApproval(identity: Identity, quoteId: string) {
    this.requireTool(identity, 'request_order_approval')
    const quoteResult = await this.pool.query(
      `SELECT id,user_id AS "userId",project_id AS "projectId",outlet_id AS "outletId",fulfilment,payment_terms AS "paymentTerms",currency,items,total_minor AS "totalMinor",quote_hash AS "quoteHash",expires_at AS "expiresAt"
       FROM quotes WHERE id=$1 AND user_id=$2 AND project_id=$3`,
      [quoteId, identity.userId, identity.projectId],
    )
    if (quoteResult.rowCount === 0) throw errors.notFound('Quote')
    const quote = rows<Quote>(quoteResult)[0]!
    const databaseNow = await this.databaseNow()
    if (new Date(quote.expiresAt) <= databaseNow) throw errors.expired('Quote')
    const expiresAt = new Date(Math.min(new Date(quote.expiresAt).getTime(), databaseNow.getTime() + APPROVAL_TTL_MS))
    const result = await this.pool.query(
      `INSERT INTO approvals(quote_id,user_id,project_id,quote_hash,outlet_id,fulfilment,payment_terms,total_minor,currency,operation,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PHP','place_order',$9) RETURNING id`,
      [quote.id, identity.userId, identity.projectId, quote.quoteHash, quote.outletId, quote.fulfilment, quote.paymentTerms, quote.totalMinor, expiresAt],
    )
    const approvalId = String(result.rows[0].id)
    await this.audit(this.pool, identity, 'request_order_approval', 'approval', approvalId, 'pending_human_confirmation', { quoteId, expiresAt })
    return { approvalId, quoteId, quoteHash: quote.quoteHash, totalMinor: quote.totalMinor, currency: 'PHP', outletId: quote.outletId, fulfilment: quote.fulfilment, paymentTerms: quote.paymentTerms, expiresAt, status: 'pending_human_confirmation' }
  }

  async confirmOrderApproval(identity: Identity, approvalId: string, quoteHash: string, confirmed: boolean) {
    if (!confirmed) throw errors.invalid('The confirmation control was not accepted')
    if (!/^[a-f0-9]{64}$/.test(quoteHash)) throw errors.invalid('A valid quoteHash from the pending approval is required')
    const result = await this.pool.query(
      `UPDATE approvals SET approved_at=now(),approved_by=$2
       WHERE id=$1 AND user_id=$2 AND project_id=$3 AND quote_hash=$4 AND consumed_at IS NULL AND approved_at IS NULL AND expires_at > now()
       RETURNING id,quote_id AS "quoteId",quote_hash AS "quoteHash",total_minor AS "totalMinor",currency,outlet_id AS "outletId",fulfilment,payment_terms AS "paymentTerms",expires_at AS "expiresAt",approved_at AS "approvedAt"`,
      [approvalId, identity.userId, identity.projectId, quoteHash],
    )
    if (!result.rowCount) throw errors.conflict('Approval is expired, already approved/used, outside this user/project, or does not match the quote')
    await this.audit(this.pool, identity, 'human_confirm_order', 'approval', approvalId, 'approved', { quoteHash })
    return result.rows[0]
  }

  async placeOrder(identity: Identity, approvalId: string, idempotencyKey: string) {
    this.requireTool(identity, 'place_order')
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) throw errors.invalid('Idempotency key must be 8-128 characters')
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const existing = await client.query(
        `SELECT id,approval_id AS "approvalId",quote_id AS "quoteId",user_id AS "userId",project_id AS "projectId",outlet_id AS "outletId",state,fulfilment,payment_terms AS "paymentTerms",currency,items,total_minor AS "totalMinor",created_at AS "createdAt",updated_at AS "updatedAt"
         FROM orders WHERE user_id=$1 AND project_id=$2 AND idempotency_key=$3`,
        [identity.userId, identity.projectId, idempotencyKey],
      )
      if (existing.rowCount) {
        if (existing.rows[0].approvalId !== approvalId) throw errors.conflict('Idempotency key was already used for a different approved action')
        await client.query('COMMIT'); return existing.rows[0]
      }
      const approvalResult = await client.query(
        `SELECT a.*,q.items,q.expires_at AS quote_expires_at FROM approvals a JOIN quotes q ON q.id=a.quote_id
         WHERE a.id=$1 AND a.user_id=$2 AND a.project_id=$3 FOR UPDATE`,
        [approvalId, identity.userId, identity.projectId],
      )
      if (!approvalResult.rowCount) throw errors.notFound('Approval')
      const approval = approvalResult.rows[0]
      if (approval.consumed_at) throw errors.conflict('Approval has already been consumed')
      if (!approval.approved_at || approval.approved_by !== identity.userId) throw errors.forbidden('A matching human confirmation is required')
      const databaseNow = await this.databaseNow(client)
      if (new Date(approval.expires_at) <= databaseNow || new Date(approval.quote_expires_at) <= databaseNow) throw errors.expired('Approval')
      const result = await client.query(
        `INSERT INTO orders(quote_id,approval_id,idempotency_key,user_id,project_id,outlet_id,fulfilment,payment_terms,currency,items,total_minor,state)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'placed')
         RETURNING id,quote_id AS "quoteId",user_id AS "userId",project_id AS "projectId",outlet_id AS "outletId",state,fulfilment,payment_terms AS "paymentTerms",currency,items,total_minor AS "totalMinor",created_at AS "createdAt",updated_at AS "updatedAt"`,
        [approval.quote_id, approval.id, idempotencyKey, identity.userId, identity.projectId, approval.outlet_id, approval.fulfilment, approval.payment_terms, approval.currency, JSON.stringify(approval.items), approval.total_minor],
      )
      await client.query(`UPDATE approvals SET consumed_at=now() WHERE id=$1`, [approvalId])
      await this.audit(client, identity, 'place_order', 'order', String(result.rows[0].id), 'success', { approvalId, idempotencyKey })
      await client.query('COMMIT')
      return result.rows[0]
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  }

  async getOrderStatus(identity: Identity, orderId: string) {
    this.requireTool(identity, 'get_order_status')
    const result = await this.pool.query(
      `SELECT id,quote_id AS "quoteId",user_id AS "userId",project_id AS "projectId",outlet_id AS "outletId",state,fulfilment,payment_terms AS "paymentTerms",currency,items,total_minor AS "totalMinor",created_at AS "createdAt",updated_at AS "updatedAt"
       FROM orders WHERE id=$1 AND user_id=$2 AND project_id=$3`, [orderId, identity.userId, identity.projectId])
    if (!result.rowCount) throw errors.notFound('Order')
    return result.rows[0]
  }

  async confirmCancellation(identity: Identity, orderId: string, confirmed: boolean) {
    if (!confirmed) throw errors.invalid('The cancellation confirmation control was not accepted')
    const order = await this.pool.query(`SELECT id,state FROM orders WHERE id=$1 AND user_id=$2 AND project_id=$3`, [orderId, identity.userId, identity.projectId])
    if (!order.rowCount) throw errors.notFound('Order')
    if (!CANCELLABLE.includes(order.rows[0].state as OrderState)) throw errors.conflict(`Order cannot be cancelled from state ${order.rows[0].state}`)
    const databaseNow = await this.databaseNow()
    const expiresAt = new Date(databaseNow.getTime() + APPROVAL_TTL_MS)
    const result = await this.pool.query(
      `INSERT INTO cancellation_confirmations(order_id,user_id,project_id,expires_at,confirmed_by) VALUES($1,$2,$3,$4,$2)
       RETURNING id,order_id AS "orderId",expires_at AS "expiresAt",confirmed_at AS "confirmedAt"`,
      [orderId, identity.userId, identity.projectId, expiresAt],
    )
    await this.audit(this.pool, identity, 'human_confirm_cancellation', 'order', orderId, 'approved', { confirmationId: result.rows[0].id })
    return result.rows[0]
  }

  async cancelOrder(identity: Identity, orderId: string, confirmationId: string) {
    this.requireTool(identity, 'cancel_order')
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const confirmation = await client.query(
        `SELECT * FROM cancellation_confirmations WHERE id=$1 AND order_id=$2 AND user_id=$3 AND project_id=$4 FOR UPDATE`,
        [confirmationId, orderId, identity.userId, identity.projectId],
      )
      if (!confirmation.rowCount) throw errors.notFound('Cancellation confirmation')
      if (confirmation.rows[0].consumed_at) throw errors.conflict('Cancellation confirmation was already used')
      const databaseNow = await this.databaseNow(client)
      if (new Date(confirmation.rows[0].expires_at) <= databaseNow) throw errors.expired('Cancellation confirmation')
      const result = await client.query(
        `UPDATE orders SET state='cancelled',updated_at=now() WHERE id=$1 AND user_id=$2 AND project_id=$3 AND state = ANY($4::text[])
         RETURNING id,state,updated_at AS "updatedAt"`, [orderId, identity.userId, identity.projectId, CANCELLABLE])
      if (!result.rowCount) throw errors.conflict('Order is no longer cancellable')
      await client.query(`UPDATE cancellation_confirmations SET consumed_at=now() WHERE id=$1`, [confirmationId])
      await this.audit(client, identity, 'cancel_order', 'order', orderId, 'success', { confirmationId })
      await client.query('COMMIT')
      return result.rows[0]
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }

  async advanceOrderState(identity: Identity, orderId: string) {
    this.requireTool(identity, 'advance_order_state')
    if (!identity.roles.includes('test_operator')) throw errors.forbidden('Test-operator role is required')
    const currentResult = await this.pool.query(`SELECT state FROM orders WHERE id=$1 AND project_id=$2`, [orderId, identity.projectId])
    if (!currentResult.rowCount) throw errors.notFound('Order')
    const next = ADVANCE[currentResult.rows[0].state as OrderState]
    if (!next) throw errors.conflict(`Order cannot advance from state ${currentResult.rows[0].state}`)
    const result = await this.pool.query(`UPDATE orders SET state=$1,updated_at=now() WHERE id=$2 RETURNING id,state,updated_at AS "updatedAt"`, [next, orderId])
    await this.audit(this.pool, identity, 'advance_order_state', 'order', orderId, 'success', { state: next })
    return result.rows[0]
  }
}
