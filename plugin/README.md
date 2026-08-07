# Content Studio Agent Plugin

Content Studio 的 Agent Plugins 1.0.0 分发包，包含可移植的 Skills 和本地
MCP Server 配置。用户只需要安装这一个包，即可在支持 Agent Plugins 的客户端
（ChatGPT/Codex、Cursor、GitHub Copilot、Kiro、VS Code 等）中使用 Content
Studio 的内容生产工作流。

## 包结构

```text
plugin/
├── plugin.json    # Agent Plugins 清单
├── mcp.json       # 本地 Content Studio MCP Server（stdio）
└── skills/
    ├── onboard-project/      # 接入项目、确认 projectId 与工具边界
    ├── produce-activity/     # 端到端内容制作流程
    └── review-and-handoff/   # 发布计划、人工接管与产物晋升
```

## 安装契约（本地 stdio 运行时）

`mcp.json` 通过 stdio 启动 `content-studio mcp --stdio`。当前本地运行时要求
显式 `--project <project.json>`，而项目清单属于用户数据，不能打进可移植包。
因此安装器负责在插件实例的 `${PLUGIN_DATA}` 目录写入用户确认过的项目清单
`project.json`（对应本地安装流程里的“第一次使用时确认项目目录”）。

前提：

- `content-studio` 可执行文件在 PATH 上（Node.js 22+，pnpm 安装）；
- `${PLUGIN_DATA}/project.json` 是合法项目清单；
- 可选 `--campaign` / `--db` 参数由安装器按用户配置追加。

公开发布目录时，`mcp.json` 应改为指向公网轻量入口的
`streamable-http`，Skills 与 `plugin.json` 不变。

## UI 定位

Agent Plugins v1 的可移植契约只有 Skills 和 MCP Server。Vue 工作台属于客户端
命名空间扩展（不在本包内），核心 MCP 工具在不渲染 UI 时仍完整可用。
