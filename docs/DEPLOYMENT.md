# Deployment Handoff

## Recommended first host

Deploy the container and PostgreSQL database on Sandz-managed infrastructure when available. Azure Container Apps, AWS App Runner or another managed container service are also suitable. Vercel is unnecessary for this service; durability comes from PostgreSQL rather than from assuming a particular process survives.

## Required platform capabilities

- Public HTTPS endpoint with a valid certificate
- Private PostgreSQL connection
- Secret manager for gateway key and delegation verification configuration
- Database migration job before application rollout
- Health checks on `/healthz` and `/readyz`
- Central logs with request/JWT `jti` correlation
- Backups and a documented restore test
- One or more disposable application replicas

## Production configuration

Use `DELEGATION_JWKS_URL` and asymmetric signatures. Do not deploy the local HS256 secret pattern as the long-term KB Sandbox integration. Keep `TEST_OPERATOR_ENABLED=false` except in an isolated showcase environment.

## Deployment sequence

1. Provision PostgreSQL and secrets.
2. Run the migration image with `node dist/src/db/migrate.js`.
3. Deploy the application image on port 8080.
4. Verify health/readiness and rejected unauthenticated requests.
5. Register `https://<host>/mcp` with KB Sandbox.
6. Grant only the intended tools to the OrderLunch Project.
7. Run read-only certification tests before enabling quotation tools.
8. Verify the trusted confirmation UI before enabling `place_order` or `cancel_order`.
9. Keep the test-only state tool disabled for normal Ember users.

## Not yet complete

The current repository needs a live PostgreSQL integration test, a KB Sandbox-compatible token issuer/JWKS decision, the confirmation UI in KB Sandbox, deployed-host selection and end-to-end certification before it is ready to register as an active consequential tool.
