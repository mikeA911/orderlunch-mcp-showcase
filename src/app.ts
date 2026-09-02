import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type pg from 'pg'
import pino from 'pino'
import type { Config } from './config.js'
import { authenticate } from './auth.js'
import { DomainError } from './domain/errors.js'
import { OrderService } from './domain/order-service.js'
import { createOrderLunchMcpServer } from './mcp-server.js'

export function createApp(config: Config, pool: pg.Pool) {
  const app = createMcpExpressApp()
  const logger = pino({ level: config.LOG_LEVEL })
  const service = new OrderService(pool)

  app.get('/healthz', (_req, res) => res.json({ status: 'ok', service: 'orderlunch-mcp-showcase' }))
  app.get('/readyz', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ready' }) }
    catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        code: typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined,
      }, 'Database readiness check failed')
      res.status(503).json({ status: 'not_ready' })
    }
  })

  app.post('/approvals/:approvalId/confirm', async (req, res, next) => {
    try {
      const identity = await authenticate(req, config)
      const value = await service.confirmOrderApproval(identity, req.params.approvalId!, String(req.body?.quoteHash ?? ''), req.body?.confirmed === true)
      res.json(value)
    } catch (error) { next(error) }
  })
  app.post('/orders/:orderId/cancellation-confirmations', async (req, res, next) => {
    try {
      const identity = await authenticate(req, config)
      const value = await service.confirmCancellation(identity, req.params.orderId!, req.body?.confirmed === true)
      res.json(value)
    } catch (error) { next(error) }
  })

  app.post('/mcp', async (req, res) => {
    let server: McpServer | undefined
    let transport: StreamableHTTPServerTransport | undefined
    try {
      const identity = await authenticate(req, config)
      server = createOrderLunchMcpServer(service, identity, config)
      transport = new StreamableHTTPServerTransport({})
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      logger.warn({ err: error, requestId: req.header('x-request-id') ?? randomUUID() }, 'MCP request rejected')
      if (!res.headersSent) {
        const known = error instanceof DomainError
        res.status(known ? error.status : 401).json({ jsonrpc: '2.0', error: { code: -32001, message: known ? error.message : 'Authentication failed' }, id: null })
      }
    } finally {
      res.on('close', () => { void transport?.close(); void server?.close() })
    }
  })
  app.get('/mcp', (_req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }))
  app.delete('/mcp', (_req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }))

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof DomainError) { res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details ?? {} } }); return }
    logger.error({ err: error }, 'Unhandled request error')
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The service could not complete the request' } })
  })
  return app
}
