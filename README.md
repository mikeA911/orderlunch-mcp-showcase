# OrderLunch MCP Showcase

A safe, simulated reference implementation showing how Ember can use a registered MCP server to prepare a lunch quotation and place a simulated order only after explicit human confirmation.

## Local setup

1. Copy `.env.example` to `.env`.
2. Replace the local gateway key and set a 32+ character `DELEGATION_HS256_SECRET`.
3. Leave `DELEGATION_JWKS_URL` unset for local HS256 testing.
4. Run `docker compose up --build`.
5. Check `http://localhost:8080/healthz` and `http://localhost:8080/readyz`.

The remote MCP endpoint is `POST /mcp`. The human confirmation boundary is `POST /approvals/:approvalId/confirm`; it is deliberately not an MCP tool.

## Commands

```sh
npm run typecheck
npm test
npm run build
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for security, approval and deployment details.

## Status

This is a showcase, not a commerce service. It has no real outlets, payments, addresses or delivery integrations.
