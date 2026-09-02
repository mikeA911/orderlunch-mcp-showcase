# OrderLunch MCP Showcase Architecture

## Purpose

This repository demonstrates a governed, simulated lunch-order flow. All quotations, approvals and orders explicitly use pay-on-delivery terms. It never contacts a real merchant, collects payment credentials, processes payment, stores a personal address or initiates delivery.

```text
Ember
  -> KB Sandbox MCP Gateway
  -> OrderLunch MCP endpoint (/mcp)
  -> application/domain service
  -> PostgreSQL
```

The same application exposes a separate human-confirmation endpoint. The model cannot call that endpoint as an MCP tool.

## Trust boundaries

Every protected request requires both:

1. `x-gateway-api-key`, authenticating the configured KB Sandbox gateway; and
2. a short-lived signed bearer token delegating a verified user, Project and allowed tool list.

Required delegation claims are `sub`, `project_id`, `tools`, `roles`, `iss`, `aud`, `exp` and `jti`. The service does not accept model-supplied identity, Project membership, prices, totals or roles as trusted data.

Production should use an asymmetric KB Sandbox JWKS. HS256 exists only for a controlled local demonstration.

## Transaction and approval model

`prepare_quotation` prices the basket from server-side menu rows and stores an immutable quote digest that includes the pay-on-delivery term. `request_order_approval` creates a short-lived pending record bound to the user, Project, outlet, fulfilment choice, payment term, exact items, total, currency and quote digest.

A trusted UI calls `POST /approvals/:id/confirm` with the matching quote digest. Only then can `place_order` consume the approval. PostgreSQL locks the approval row, creates one order and marks the approval consumed in the same transaction. A unique `(user_id, project_id, idempotency_key)` constraint makes identical retries return the original order and rejects reuse for a different approval. Cancellation follows the same rule: trusted UI creates a short-lived confirmation through `POST /orders/:id/cancellation-confirmations`, and the MCP tool must consume that exact confirmation.

Containers and MCP sessions are disposable. PostgreSQL is authoritative for quotes, approvals, orders, idempotency and audit events.

## MCP tools

| Tool | Classification | Human gate |
| --- | --- | --- |
| `list_outlets` | Read-only | No |
| `browse_menu` | Read-only | No |
| `check_availability` | Read-only | No |
| `prepare_quotation` | Reversible database write | No purchase |
| `request_order_approval` | Reversible database write | Creates pending request only |
| `place_order` | Consequential simulated action | Confirmed, bound approval required |
| `get_order_status` | Read-only | No |
| `cancel_order` | Consequential simulated action | Explicit confirmation required |
| `advance_order_state` | Test-only write | Signed `test_operator` role; disabled by default |

## Deployment

The service is a portable Docker image. A deployment needs HTTPS termination, a managed PostgreSQL database, secret storage, log collection and a single public MCP endpoint. Multiple application replicas are safe because no business state is held in process memory.
