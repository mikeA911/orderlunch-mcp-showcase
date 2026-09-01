import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SignJWT } from 'jose'

const issuer = process.env.DELEGATION_ISSUER!
const audience = process.env.DELEGATION_AUDIENCE!
const secret = process.env.DELEGATION_HS256_SECRET!
const gatewayKey = process.env.GATEWAY_API_KEY!
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080'
if (!issuer || !audience || !secret || !gatewayKey) throw new Error('Local delegation and gateway configuration is required')

const tools = ['list_outlets','browse_menu','check_availability','prepare_quotation','request_order_approval','place_order','get_order_status','cancel_order','advance_order_state']
const token = await new SignJWT({ project_id: 'orderlunch-local-project', tools, roles: ['member', 'test_operator'] })
  .setProtectedHeader({ alg: 'HS256' }).setSubject('local-smoke-user').setIssuer(issuer).setAudience(audience)
  .setJti(randomUUID()).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret))
const headers = { authorization: `Bearer ${token}`, 'x-gateway-api-key': gatewayKey, 'content-type': 'application/json' }
const client = new Client({ name: 'orderlunch-local-smoke', version: '0.1.0' })
const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers } })
await client.connect(transport)

async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args })
  return response as { isError?: boolean; structuredContent?: Record<string, unknown> }
}

try {
  if (process.env.SMOKE_ORDER_ID) {
    const persisted = await call('get_order_status', { orderId: process.env.SMOKE_ORDER_ID })
    if (persisted.isError) throw new Error('Persisted order was not readable after restart')
    console.log(JSON.stringify({ status: 'persistence-passed', order: persisted.structuredContent }, null, 2))
    process.exitCode = 0
  } else {
  const catalogue = await client.listTools()
  if (!catalogue.tools.some((tool) => tool.name === 'place_order')) throw new Error('MCP tool catalogue is incomplete')
  const outlets = await call('list_outlets')
  if (outlets.isError) throw new Error('list_outlets failed')
  const menu = await call('browse_menu', { outletId: 'canteen-sim' })
  if (menu.isError) throw new Error('browse_menu failed')
  const quote = await call('prepare_quotation', { outletId: 'canteen-sim', fulfilment: 'pickup', basket: [{ menuItemId: 'canteen-adobo', quantity: 2 }] })
  if (quote.isError) throw new Error('prepare_quotation failed')
  const quoteData = quote.structuredContent!
  const pending = await call('request_order_approval', { quoteId: quoteData.id })
  if (pending.isError) throw new Error('request_order_approval failed')
  const pendingData = pending.structuredContent!
  const beforeHuman = await call('place_order', { approvalId: pendingData.approvalId, idempotencyKey: 'local-smoke-order-1' })
  if (!beforeHuman.isError) throw new Error('place_order succeeded without human confirmation')
  const confirmedResponse = await fetch(`${baseUrl}/approvals/${pendingData.approvalId}/confirm`, {
    method: 'POST', headers, body: JSON.stringify({ quoteHash: quoteData.quoteHash, confirmed: true }),
  })
  if (!confirmedResponse.ok) throw new Error(`Human confirmation failed: ${confirmedResponse.status}`)
  const placed = await call('place_order', { approvalId: pendingData.approvalId, idempotencyKey: 'local-smoke-order-1' })
  if (placed.isError) throw new Error('place_order failed after confirmation')
  const order = placed.structuredContent!
  const retry = await call('place_order', { approvalId: pendingData.approvalId, idempotencyKey: 'local-smoke-order-1' })
  if (retry.isError || retry.structuredContent?.id !== order.id) throw new Error('Idempotent retry did not return the original order')
  const cancellationResponse = await fetch(`${baseUrl}/orders/${order.id}/cancellation-confirmations`, {
    method: 'POST', headers, body: JSON.stringify({ confirmed: true }),
  })
  if (!cancellationResponse.ok) throw new Error(`Cancellation confirmation failed: ${cancellationResponse.status}`)
  const cancellation = await cancellationResponse.json() as { id: string }
  const cancelled = await call('cancel_order', { orderId: order.id, confirmationId: cancellation.id })
  if (cancelled.isError || cancelled.structuredContent?.state !== 'cancelled') throw new Error('cancel_order failed')
  console.log(JSON.stringify({ status: 'passed', toolCount: catalogue.tools.length, orderId: order.id, quoteId: quoteData.id, finalState: 'cancelled' }, null, 2))
  }
} finally {
  await client.close()
}
