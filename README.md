# EAR Desktop

EAR 的 macOS 和 Windows 客户端。EarRecorder 在 iPhone 上录音并上传，云端 EAR 负责识别、入库和生成分析结果。桌面端通过云端 EAR API 展示结果，并提供本地 `ear-mcp` 的配置入口，供 Codex 或 Claude Code 使用。

当前仓库包含可运行的桌面工程骨架和技术文档。云端连接、转写与总结列表、MCP 安装和发行安装包在后续切片实现。

| 文档 | 内容 |
|---|---|
| [系统架构](docs/architecture.md) | 三端职责、进程边界、录音到结果的流程 |
| [云端接口与 MCP](docs/integration.md) | 已有接口、待确认契约、凭据和兼容策略 |
| [开发与双平台交付](docs/development.md) | 工程结构、构建步骤、首版范围与验收 |

## 本地运行

需要 Node.js 22.12 或更新的受支持版本。首次启动时 Electron 会下载当前平台的运行时。

```sh
npm ci
npm run typecheck
npm run dev
```

`npm run dev` 先编译工程再打开 Electron 窗口。修改源码后重新运行即可。此阶段可在没有云端账号和录音的情况下启动。

相关仓库：[EarRecorder](https://github.com/Echo-As-Record/EarRecorder) · [云端 EAR](https://github.com/Echo-As-Record/Echo-As-Record)。
