# Moltbot on Cloudflare Workers

**Moltbot on Cloudflare** 是一个基于 Cloudflare Workers + Cloudflare Containers 的封装，用容器运行 Moltbot Gateway，并由 Worker 代理 HTTP/WebSocket 流量。

简体中文 | [English](README.md)

## 快速开始

### 前置条件

- pnpm（推荐）
- Node.js（推荐 v20+）
- Wrangler CLI（`pnpm add -g wrangler`）

### 安装依赖

```bash
pnpm install
```

### 本地开发

```bash
pnpm dev
# 或
pnpm start
```

### 部署

```bash
pnpm deploy
```

## 配置说明

### 基础鉴权（Worker 层）

在 `wrangler.jsonc`（vars）或 Cloudflare 控制台里设置：

| 变量名            | 说明                                 | 默认值 |
| ----------------- | ------------------------------------ | ------ |
| `SERVER_PASSWORD` | 访问密码，不设置则关闭鉴权           | (空)   |
| `SERVER_USERNAME` | 访问用户名                           | `moltbot` |

### Moltbot Gateway（容器层）

| 变量名                   | 说明                                 | 默认值 |
| ------------------------ | ------------------------------------ | ------ |
| `MOLTBOT_GATEWAY_PORT`   | Gateway 容器内端口                   | `18789` |
| `MOLTBOT_GATEWAY_BIND`   | 绑定模式（容器建议 `lan`）           | `lan` |
| `MOLTBOT_STATE_DIR`      | 状态目录（配置、会话、日志）         | `/root/s3/moltbot` |
| `MOLTBOT_WORKSPACE_DIR`  | Agent 工作区目录                      | `/root/s3/clawd` |
| `MOLTBOT_ARGS`           | 额外的 `moltbot gateway` 参数         | (空) |

### 配置注入（可选）

| 变量名               | 说明                                   |
| -------------------- | -------------------------------------- |
| `MOLTBOT_CONFIG_JSON` | 直接写入的 JSON/JSON5 字符串配置       |
| `MOLTBOT_CONFIG_PATH` | 覆盖配置文件路径                       |

如果没有设置，容器会在首次启动时将 `config/moltbot/moltbot.json` 复制到状态目录。

### S3 / R2 持久化（可选）

设置以下变量后，将使用 TigrisFS 把对象存储挂载到 `/root/s3`：

| 变量名                 | 说明                                 | 必填 | 默认值 |
| ---------------------- | ------------------------------------ | ---- | ------ |
| `S3_ENDPOINT`          | S3 API 端点                          | ✅   | -      |
| `S3_BUCKET`            | 桶名                                 | ✅   | -      |
| `S3_ACCESS_KEY_ID`     | Access Key ID                        | ✅   | -      |
| `S3_SECRET_ACCESS_KEY` | Access Key Secret                    | ✅   | -      |
| `S3_REGION`            | 区域                                 | ❌   | `auto` |
| `S3_PATH_STYLE`        | 是否 Path Style                      | ❌   | `false` |
| `S3_PREFIX`            | 桶内前缀路径                          | ❌   | (根)   |
| `TIGRISFS_ARGS`        | 额外的 TigrisFS 挂载参数             | ❌   | -      |

## 项目结构

```
.
├── src/
│   ├── index.ts        # Worker 入口（鉴权 + 转发）
│   └── container.ts    # MoltbotContainer（容器 DO）
├── config/
│   └── moltbot/
│       └── moltbot.json # 默认配置模板
├── Dockerfile          # Moltbot 容器镜像
├── wrangler.jsonc      # Wrangler 配置
├── tsconfig.json       # TypeScript 配置
└── package.json
```

## 备注

- Worker 会把 HTTP/WS 请求转发到容器内的 Moltbot Gateway。
- Gateway 自身的 token/password 鉴权需要在 Moltbot 配置中设置，和 Worker Basic Auth 独立。
- 如果需要额外系统依赖（如 `ffmpeg`），请修改 Dockerfile 并重新部署。

## 建议下一步

1. 在 `moltbot.json` 里配置模型与渠道。
2. 设置 `SERVER_PASSWORD` 保护公网入口。
3. 启用 S3/R2 持久化，保证重启后状态不丢失。
