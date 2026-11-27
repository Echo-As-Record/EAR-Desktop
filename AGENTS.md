---
audience: ai
doc-type: guide
based-on: README.md；docs/architecture.md；docs/integration.md；docs/development.md
---

# AGENTS.md

- 先读 [README.md](README.md)，再按任务查阅桌面端的[架构](docs/architecture.md)、[接口](docs/integration.md)和[验收](docs/verification.md)。
- macOS 和 Windows 共用主线。平台差异集中在 Electron 主进程及发行配置。改动在短期功能分支上开发，按团队流程通过 PR 合回主线。
- 云端接口、手机上传协议与 MCP 工具由上游 EAR 仓库定义。发现客户端与上游不一致时，记录实际差异及影响范围，再决定在哪一端修正。
- 用户可见行为、启动命令、配置或验证方式变化时，同步更新对应文档。区分设计、已经实现的行为和有证据支持的验收结果。人工审核字段由审核人填写。
- 样例和测试使用合成数据。令牌、真实录音、转写、用户数据、证书私钥和签名凭据留在仓库外，也从日志及 PR 说明中排除。
- 提交前运行 `npm run typecheck`、`npm run build` 和 `git diff --check`。文档改动检查链接，涉及连接、IPC 或结果展示时按[联调指南](docs/verification.md)复验。交付时说明平台和环境，以及仍未验证的项目。
