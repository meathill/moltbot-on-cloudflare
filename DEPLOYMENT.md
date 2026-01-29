# 部署指南

本文档说明如何将本项目部署到 Cloudflare Workers + Cloudflare Containers。

## 前置条件

- 已开通 Cloudflare 账号（可用 Workers + Containers）
- 本地安装 pnpm、Node.js（建议 v20+）
- 已安装 Wrangler CLI（`pnpm add -g wrangler`）

## 一次性准备

### 1) 安装依赖

```bash
pnpm install
```

### 2) 登录 Wrangler

```bash
wrangler login
```

## 配置说明

### Worker 层 Basic Auth

- 设置 `SERVER_PASSWORD` 后即开启鉴权
- 不设置则关闭鉴权
- `SERVER_USERNAME` 可选，默认 `meathillbot`

### 容器层 Moltbot 配置

- `config/moltbot/moltbot.json` 是默认配置模板
- 可用环境变量覆盖：
  - `MOLTBOT_CONFIG_JSON`：直接写入配置内容（JSON/JSON5）
  - `MOLTBOT_CONFIG_PATH`：指定配置文件路径

### 环境变量与 Secrets

推荐做法：敏感信息用 `wrangler secret put`，非敏感信息在 Cloudflare 控制台 Variables 中设置。

常用变量：

- `SERVER_PASSWORD`（建议 Secret）
- `SERVER_USERNAME`
- `MOLTBOT_GATEWAY_PORT`（默认 18789）
- `MOLTBOT_GATEWAY_BIND`（默认 lan）
- `MOLTBOT_STATE_DIR`（默认 /root/s3/moltbot）
- `MOLTBOT_WORKSPACE_DIR`（默认 /root/s3/clawd）
- `MOLTBOT_ARGS`（可选）

S3/R2 持久化（可选）：

- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`（建议 Secret）
- `S3_SECRET_ACCESS_KEY`（建议 Secret）
- `S3_REGION`（可选）
- `S3_PATH_STYLE`（可选）
- `S3_PREFIX`（可选）
- `TIGRISFS_ARGS`（可选）

## 部署步骤

### 1) 设置 Secrets（示例）

```bash
wrangler secret put SERVER_PASSWORD
wrangler secret put S3_ACCESS_KEY_ID
wrangler secret put S3_SECRET_ACCESS_KEY
```

### 2) 配置 Variables（控制台）

在 Cloudflare Dashboard 的 Worker 项目里设置非敏感变量，例如：

- `SERVER_USERNAME`
- `MOLTBOT_GATEWAY_PORT`
- `MOLTBOT_GATEWAY_BIND`
- `MOLTBOT_STATE_DIR`
- `MOLTBOT_WORKSPACE_DIR`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_PREFIX`

> 如需在 `wrangler.jsonc` 增加 `vars`，记得运行 `pnpm cf-typegen`。

### 3) 部署

```bash
pnpm deploy
```

## 验证与常见检查

1. 部署完成后，Wrangler 会输出访问地址。
2. 若启用了 Basic Auth，请使用浏览器输入账号密码访问。
3. 首次启动可能需要拉取依赖并初始化配置，等待 1-2 分钟后刷新。
4. 若使用 R2，请确认 `S3_*` 变量正确，容器日志中应看到挂载成功提示。

## 升级与重新部署

- 修改 Worker/Container 代码后，直接执行 `pnpm deploy` 重新发布。
- 修改 `wrangler.jsonc`（绑定/容器参数）后，先 `pnpm cf-typegen` 再部署。

## 常见问题

- 访问 401：说明启用了 Basic Auth，请检查 `SERVER_PASSWORD` 与账号。
- 启动失败：检查 `moltbot.json` 配置是否完整、R2/S3 变量是否正确。
- 状态丢失：请开启 R2 持久化，确认 `S3_*` 配置有效。
