import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod/v4'
import type { Config } from './config.js'
import type { OrderService } from './domain/order-service.js'
import type { Identity } from './domain/types.js'
import { DomainError } from './domain/errors.js'

function result(value: unknown) {
  const structuredContent = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { items: value }
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], structuredContent }
}

function failure(error: unknown) {
  const known = error instanceof DomainError
  const body = known ? { error: { code: error.code, message: error.message, details: error.details ?? {} } } : { error: { code: 'INTERNAL_ERROR', message: 'The OrderLunch service could not complete the request' } }
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(body) }], structuredContent: body }
}

function safe<T>(operation: () => Promise<T>) {
  return operation().then(result).catch(failure)
}

export function createOrderLunchMcpServer(service: OrderService, identity: Identity, config: Config): McpServer {
  const server = new McpServer({ name: 'orderlunch-mcp-showcase', version: '0.1.0' })
  server.registerTool('list_outlets', {
    description: 'List simulated food outlets. Read-only; never contacts a real merchant.', inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => safe(() => service.listOutlets(identity)))
  server.registerTool('browse_menu', {
    description: 'Browse the simulated menu and server-authoritative PHP prices for one outlet.',
    inputSchema: { outletId: z.string().min(1) }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ outletId }) => safe(() => service.browseMenu(identity, outletId)))
  server.registerTool('check_availability', {
    description: 'Check availability of simulated menu items.', inputSchema: { menuItemIds: z.array(z.string().min(1)).min(1).max(20) }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ menuItemIds }) => safe(() => service.checkAvailability(identity, menuItemIds)))
  server.registerTool('prepare_quotation', {
    description: 'Create an immutable, expiring simulated quotation. This never places or purchases an order.',
    inputSchema: { outletId: z.string().min(1), fulfilment: z.enum(['pickup', 'delivery']), basket: z.array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().min(1).max(20) })).min(1).max(20) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ outletId, fulfilment, basket }) => safe(() => service.prepareQuotation(identity, outletId, fulfilment, basket)))
  server.registerTool('request_order_approval', {
    description: 'Create a pending approval request for a quote. A separate trusted human UI must confirm it before order placement.',
    inputSchema: { quoteId: z.string().uuid() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ quoteId }) => safe(() => service.requestOrderApproval(identity, quoteId)))
  server.registerTool('place_order', {
    description: 'Place a simulated order only after a matching human confirmation. Consequential and idempotent; never performs a real purchase.',
    inputSchema: { approvalId: z.string().uuid(), idempotencyKey: z.string().min(8).max(128) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, ({ approvalId, idempotencyKey }) => safe(() => service.placeOrder(identity, approvalId, idempotencyKey)))
  server.registerTool('get_order_status', {
    description: 'Read the state of the caller\'s simulated order in the current project.', inputSchema: { orderId: z.string().uuid() }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ orderId }) => safe(() => service.getOrderStatus(identity, orderId)))
  server.registerTool('cancel_order', {
    description: 'Cancel a simulated order in a cancellable state. Requires a short-lived confirmation ID created by trusted UI.',
    inputSchema: { orderId: z.string().uuid(), confirmationId: z.string().uuid() }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, ({ orderId, confirmationId }) => safe(() => service.cancelOrder(identity, orderId, confirmationId)))
  if (config.TEST_OPERATOR_ENABLED) {
    server.registerTool('advance_order_state', {
      description: 'TEST ONLY: advance a simulated order state. Requires a signed test_operator role.', inputSchema: { orderId: z.string().uuid() }, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    }, ({ orderId }) => safe(() => service.advanceOrderState(identity, orderId)))
  }
  return server
}
