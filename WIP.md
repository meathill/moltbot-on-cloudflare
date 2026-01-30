# WIP

## 目标

- 在最简容器基础上恢复 Moltbot Gateway（稳健版配置文件）

## Todo

- [x] 容器改为最简状态服务（仅返回内部状态）
- [x] Worker 保留 /__diag 与 /__do 诊断入口
- [x] 精简 wrangler.jsonc 与 .env.example
- [x] 更新 DEPLOYMENT.md
- [x] 重新部署并验证 `/`、`/healthz`、`/__diag`、`/__do`
- [x] 增加容器入口模式切换（status / moltbot）
- [x] 生成最小 Moltbot 配置文件并启动 Gateway
- [x] 增加 probe 模式与 CLI 探测输出
- [x] 调整容器安装包为 `clawdbot@latest`
- [x] 如 alpine 安装失败，切换到 Debian slim 并补齐构建依赖
- [x] 修正默认配置路径为 `~/.clawdbot/moltbot.json`
- [x] 自动配对改为 devices（Control UI device pairing）
- [ ] 重新部署并验证 Gateway 能监听端口
- [ ] 重新部署并验证 UI pairing required 消失
