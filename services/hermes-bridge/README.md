# BG Company Hermes Bridge

Internal-only bridge service for Phase 1-C.7. It wraps the Hermes CLI oneshot path with a narrow HTTP interface that BG Company can call from the Docker network.

## Endpoints

- `GET /health`
- `POST /run` with `x-bridge-api-key`

Only `agentId=content-planner` and `taskType=content_planning` are allowed. The bridge is not exposed through Traefik and has no public port.

## Security rules

- Do not mount the Docker socket into the web container.
- Do not expose this service publicly.
- Do not pass user input to a shell command.
- Keep `BRIDGE_API_KEY` in `.env` only.
- Keep concurrency low until production behavior is well understood.
