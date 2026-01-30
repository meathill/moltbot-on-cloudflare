# 部署指南（最简容器 + Moltbot Gateway）

本文档描述如何把最简容器版本部署到 Cloudflare Workers + Containers，并逐步切换到 Moltbot Gateway。

## 前置条件

- 已开通 Cloudflare Workers + Containers
- Node.js >= 24
- pnpm
- Wrangler CLI（`pnpm add -g wrangler`）

## 一次性准备

### 1) 安装依赖

```bash
pnpm install
```

### 2) 登录 Wrangler

```bash
wrangler login
```

## 环境变量

### Worker 层 Basic Auth（可选）

- `SERVER_PASSWORD`：设置后启用 Basic Auth
- `SERVER_USERNAME`：可选，默认 `moltbot`

### 诊断开关（可选）

- `DIAGNOSTICS_ENABLED`：`true` 时开放 `/__diag` 与 `/__do`

### 容器最简服务（可选，默认）

- `CONTAINER_STATUS_MESSAGE`：返回 JSON 的 message 字段
- `CONTAINER_VERSION`：返回 JSON 的 version 字段
- `CONTAINER_PORT`：容器监听端口（默认 18789）
- `CONTAINER_BIND`：容器监听地址（默认 0.0.0.0）

### 容器模式切换

- `CONTAINER_MODE=status|moltbot|probe`：默认 `status`

### Moltbot Gateway（稳健版）

- `CLAWDBOT_GATEWAY_TOKEN`：Gateway Token（Secret，必填）
- `MOLTBOT_GATEWAY_BIND`：Gateway 绑定模式（默认 `lan`）
- `MOLTBOT_GATEWAY_PORT`：Gateway 端口（默认 18789）
- `MOLTBOT_GATEWAY_AUTH_MODE`：认证模式（默认 `token`）
- `MOLTBOT_GATEWAY_VERBOSE`：是否启用 verbose（默认 false）
- `MOLTBOT_ALLOW_UNCONFIGURED`：是否允许无配置启动（默认 false）
- `MOLTBOT_CLI`：指定 CLI 命令（默认自动探测）
- `MOLTBOT_CONFIG_JSON`：可选，自定义配置 JSON/JSON5（不建议在变量里直接放明文）
- `CLAWDBOT_CONFIG_PATH`：可选，配置文件路径（默认 `/root/.clawdbot/moltbot.json`）
- `CLAWDBOT_GATEWAY_URL`：可选，覆盖自动配对使用的网关地址
- `CLAWDBOT_AUTO_APPROVE_DEVICES`：自动配对设备（默认 false）
- `CLAWDBOT_AUTO_APPROVE_NODES`：旧字段，等价于 `CLAWDBOT_AUTO_APPROVE_DEVICES`
- `CLAWDBOT_AUTO_APPROVE_INTERVAL_MS`：自动配对轮询间隔（默认 4000ms）

> 说明：镜像内默认安装 `clawdbot@latest` 并自动探测 CLI，可用 `MOLTBOT_CLI=clawdbot` 强制指定。

## 配置建议

- 敏感信息（如 `SERVER_PASSWORD`）请使用 `wrangler secret put`
- 非敏感变量可放在 Cloudflare Dashboard 的 Variables，或写入 `wrangler.jsonc` 的 `vars`

> 如果修改了 `wrangler.jsonc`，建议运行 `pnpm cf-typegen` 以刷新类型文件。

## 部署步骤（最简容器）

### 1) 设置 Secrets（可选）

```bash
wrangler secret put SERVER_PASSWORD
```

### 2) 设置 Variables（可选）

在 Cloudflare Dashboard 的 Worker 项目里设置：

- `DIAGNOSTICS_ENABLED`
- `CONTAINER_STATUS_MESSAGE`
- `CONTAINER_VERSION`
- `CONTAINER_PORT`
- `CONTAINER_BIND`

### 3) 部署

```bash
pnpm deploy
```

## 验证（最简容器）

1. 访问根路径 `/`：应返回 JSON 状态。
2. 访问 `/healthz`：应返回 `ok`。
3. 若开启诊断，访问 `/__diag`：应返回 Worker + 容器摘要。
4. 若开启诊断，访问 `/__do?action=state|start|wait`：可查看容器状态与最近错误。

## 切换到 Moltbot Gateway（稳健版）

1. 确保已设置 `CLAWDBOT_GATEWAY_TOKEN`（Secret）。
2. 设置 `CONTAINER_MODE=moltbot`。
3. （可选）设置 `MOLTBOT_GATEWAY_BIND` 与 `MOLTBOT_GATEWAY_PORT`。
4. 重新部署：`pnpm deploy`。

## 验证（Moltbot）

1. 访问根路径 `/`：应返回 Moltbot Gateway 的响应（不再是最简 JSON）。
2. 若诊断开启，访问 `/__diag` 确认容器环境包含 `MOLTBOT_GATEWAY_*` 与 `CLAWDBOT_GATEWAY_TOKEN`。
3. 若 Gateway 无响应，访问 `/__do?action=wait` 获取最近错误快照。

## 自动配对（可选）

设置 `CLAWDBOT_AUTO_APPROVE_DEVICES=true` 后，容器会定期执行 `clawdbot devices list --json` 并自动 approve 所有 pending 设备请求，用于快速试用与排障。
（兼容旧字段：`CLAWDBOT_AUTO_APPROVE_NODES=true`）

手动配对可用：

```bash
clawdbot devices list --json --url ws://127.0.0.1:18789 --token $CLAWDBOT_GATEWAY_TOKEN
clawdbot devices approve <requestId> --url ws://127.0.0.1:18789 --token $CLAWDBOT_GATEWAY_TOKEN
```

## Probe 模式（排查用）

当 `CONTAINER_MODE=probe` 时，只启动最简服务并附带 Moltbot CLI 探测结果，方便确认 CLI 是否可执行：

1. 访问 `/` 返回 JSON，其中 `probe` 字段包含 `moltbot/clawdbot/clawd` 的探测结果。
2. 若 `probe.ok=false`，说明 CLI 未找到或无法执行，需要调整镜像或 CLI 名称。

## 常见问题

- 401：说明启用了 Basic Auth，请检查 `SERVER_PASSWORD`。
- `/__diag` 404：说明未开启 `DIAGNOSTICS_ENABLED=true`。
- 容器未监听端口：先访问 `/__do?action=start`，再访问 `/__do?action=wait` 查看错误快照。
