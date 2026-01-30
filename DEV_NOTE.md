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
- status/probe 模式提供 `/__status` 状态入口，用于查看容器状态与启动错误快照。
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

## 排障记录：SQLite 权限与 DO 迁移问题

### 现象
- DQ 日志出现：
  - `SQL Execution Error: access to _cf_METADATA.key is prohibited: SQLITE_AUTH`
- 部署时报错：
  - `Cannot apply new-sqlite-class migration to class 'MoltbotContainer'`
  - `New version of script does not export class 'MoltbotContainer'`
  - `Cannot apply deleted_classes migration to non-existent class MoltbotContainer`

### 关键卡点与根因
- **DO 类名/导出不一致**：Worker 代码没有导出指定的 DO 类，或类名发生变化，导致迁移失败。
- **迁移策略不匹配**：尝试对已被依赖的 DO 类做 `new-sqlite-class` 或删除，Cloudflare 会拒绝。
- **SQLite 权限限制**：Cloudflare 的 sqlite 环境禁止访问 `_cf_METADATA` 等内部表。

### 解决方案（已验证）
- 确保 `export { MoltbotContainer }` 且 DO 绑定名称与类名一致。
- 避免对已使用的 DO 类做破坏性迁移；必要时**删除 Worker 并重建**，避免迁移冲突。
- 不在容器侧直接访问 Cloudflare 的内部 sqlite metadata 表。

## 排障记录：UI 可打开但 Health Offline / Schema unavailable

### 现象
- Control UI 能打开，但右上角 `Health Offline`。
- `Settings > Config` 显示 `Schema unavailable`。
- UI 提示 `disconnected (1008): pairing required` 或 `unauthorized: gateway token missing`。

### 关键卡点与根因
- **Gateway 未真正启动**：容器虽然响应 `/`，但实际网关进程崩溃或未监听 WS。
- **未完成 device pairing**：UI 连接未配对即被断开。
- **配置路径/环境变量不一致**：`CLAWDBOT_CONFIG_PATH` 指向错误位置会导致配置/Schema 读取失败。
- **UI 不安全上下文**：非 HTTPS 或非 localhost 时，WebCrypto 不可用，默认拒绝配对。

### 解决方案（已验证）
- 先切换 `CONTAINER_MODE=probe`，访问 `/__status` 确认 CLI 探测与启动错误，再打开 UI。
- 自动配对改为 `devices` 并确保 CLI 能连到网关（LAN IP / 指定 `CLAWDBOT_GATEWAY_URL`）。
- 对齐配置路径为 `~/.clawdbot/moltbot.json`，确保网关启动后可提供 `config.schema`。
