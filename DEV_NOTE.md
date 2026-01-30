# DEV_NOTE

## 排障记录：容器无法启动 / 端口不监听

### 现象
- DO 日志反复出现：
  - `Container crashed while checking for ports`
  - `The container is not listening in the TCP address 10.0.0.1:18789`
- Worker 侧基本没有应用日志，无法判断容器是否真的启动。

### 关键卡点与根因
- **容器入口没有稳定监听端口**：进程未绑定到 `PORT/CONTAINER_PORT`，导致健康检查失败。
- **缺少容器内可见日志**：只看 DO 日志无法定位实际启动阶段。
- **镜像环境差异**：Alpine 下安装 CLI 失败，导致入口直接退出。

### 解决方案（已验证）
- 引入最简 **status server**（`/` 与 `/healthz`）用于确认端口监听。
- Worker 侧保留 `/__diag` 与 `/__do` 诊断入口，用于查看容器状态与错误快照。
- 容器入口支持 `CONTAINER_MODE=status|probe|moltbot`，先用 status/probe 验证基础连通性。
- 镜像切换到 `node:24-bookworm-slim` 并补齐构建依赖，保证 CLI 可安装、入口不退出。

## 排障记录：Cloudflare 容器 + Moltbot 配对

### 现象
- UI 一直显示 `pairing required`，日志里出现 `gateway closed (1006)`。

### 关键卡点与根因
- **CLI 不可用**：安装了 `moltbot` 包但无 CLI bin → 探测 `moltbot`/`clawdbot`/`clawd` 全部失败。
- **配对 API 用错**：最初用 `nodes pending/approve`（旧 pairing 存储），不影响 UI 设备配对。
- **网关地址错误**：自动配对默认连 `ws://127.0.0.1:18789`，但网关 `bind=lan` 不监听 loopback → 连接必然失败。

### 解决方案（已验证）
- 使用 `clawdbot@latest` 作为 CLI。
- 自动配对改为 **devices pairing**：
  - `clawdbot devices list --json`
  - `clawdbot devices approve <requestId>`
- 自动配对连接改为 **容器 LAN IP**；必要时手动指定：
  - `CLAWDBOT_GATEWAY_URL=ws://<lan-ip>:18789`
- 保留环境变量开关：
  - `CLAWDBOT_AUTO_APPROVE_DEVICES=true`

### 经验
- `bind=lan` 时，**不要假设 127.0.0.1 可用**；配对/CLI 需连接容器 LAN IP。
- UI pairing 依赖 **device pairing**，不是 `nodes pending/approve`。
