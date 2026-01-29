# Moltbot on Cloudflare Workers

**Moltbot on Cloudflare** is a Cloudflare Workers + Cloudflare Containers wrapper that runs the Moltbot Gateway inside a container and forwards HTTP/WebSocket traffic from the Worker.

English | [简体中文](README.zh-CN.md)

## Quick Start

### Prerequisites

- pnpm (recommended)
- Node.js (v20+ recommended)
- Wrangler CLI (`pnpm add -g wrangler`)

### Install Dependencies

```bash
pnpm install
```

### Local Development

```bash
pnpm dev
# or
pnpm start
```

### Deploy

```bash
pnpm deploy
```

## Configuration

### Basic Auth (Worker Layer)

Set these variables in `wrangler.jsonc` (vars) or the Cloudflare Dashboard:

| Variable Name     | Description                                       | Default |
| ----------------- | ------------------------------------------------- | ------- |
| `SERVER_PASSWORD` | Access password. If not set, auth is disabled.    | (empty) |
| `SERVER_USERNAME` | Access username.                                  | `moltbot` |

### Moltbot Gateway Settings (Container Layer)

| Variable Name            | Description                                 | Default |
| ------------------------ | ------------------------------------------- | ------- |
| `MOLTBOT_GATEWAY_PORT`   | Gateway port inside the container           | `18789` |
| `MOLTBOT_GATEWAY_BIND`   | Bind mode (`lan` recommended in container)  | `lan` |
| `MOLTBOT_STATE_DIR`      | State directory (config, sessions, logs)    | `/root/s3/moltbot` |
| `MOLTBOT_WORKSPACE_DIR`  | Agent workspace directory                    | `/root/s3/clawd` |
| `MOLTBOT_ARGS`           | Extra CLI args for `moltbot gateway`         | (empty) |

### Config Injection (Optional)

You can inject a config file at boot:

| Variable Name         | Description                                     |
| --------------------- | ----------------------------------------------- |
| `MOLTBOT_CONFIG_JSON` | Inline JSON/JSON5 string written to config path |
| `MOLTBOT_CONFIG_PATH` | Override the config file path                   |

If neither is set, the container copies `config/moltbot/moltbot.json` into the state directory (if missing).

### S3 / R2 Persistence (Optional)

If you set the following variables, the container will mount object storage at `/root/s3` using TigrisFS.

| Variable Name          | Description                                  | Required | Default  |
| ---------------------- | -------------------------------------------- | -------- | -------- |
| `S3_ENDPOINT`          | S3 API endpoint address                      | ✅ Yes   | -        |
| `S3_BUCKET`            | Bucket name                                  | ✅ Yes   | -        |
| `S3_ACCESS_KEY_ID`     | Access key ID                                | ✅ Yes   | -        |
| `S3_SECRET_ACCESS_KEY` | Access key secret                            | ✅ Yes   | -        |
| `S3_REGION`            | Storage region                               | ❌ No    | `auto`   |
| `S3_PATH_STYLE`        | Whether to use Path Style access             | ❌ No    | `false`  |
| `S3_PREFIX`            | Path prefix (subdirectory) within the bucket | ❌ No    | (root)   |
| `TIGRISFS_ARGS`        | Additional mount arguments for TigrisFS      | ❌ No    | -        |

## Project Structure

```
.
├── src/
│   ├── index.ts        # Worker entry (auth + request forwarding)
│   └── container.ts    # MoltbotContainer (extends Container)
├── config/
│   └── moltbot/
│       └── moltbot.json # Default config template
├── Dockerfile          # Container image for Moltbot
├── wrangler.jsonc      # Wrangler configuration
├── tsconfig.json       # TypeScript configuration
└── package.json
```

## Notes

- The Worker forwards HTTP and WebSocket traffic to the containerized Moltbot Gateway.
- Gateway auth (token/password) is configured in Moltbot’s config and is separate from Worker Basic Auth.
- If you need extra system packages (e.g. `ffmpeg`), add them to the Dockerfile and redeploy.

## Recommended Next Steps

1. Configure your model provider and channels in `moltbot.json`.
2. Set `SERVER_PASSWORD` to protect the public endpoint.
3. Enable S3/R2 persistence to keep sessions and credentials across restarts.
