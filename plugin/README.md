# Content Studio Plugin

这是 Content Studio 面向 ChatGPT/Codex 的本地开发包。它按 OpenAI Plugin
目录约定组合 3 个 Skills 与一个本地 stdio MCP Server；Vue 工作台不是可移植
插件组件，核心 MCP 工具在不渲染 UI 时仍可使用。

## 包结构

```text
plugin/
├── .codex-plugin/
│   └── plugin.json   # 必需的 Plugin 清单
├── .mcp.json         # 随包分发的本地 MCP Server 配置
└── skills/
    ├── onboard-project/
    ├── produce-activity/
    └── review-and-handoff/
```

## 当前本地开发契约

这个目录目前不是“一装即用”的公开发行物。使用前必须先从源码构建并让
`content-studio` 可执行文件位于宿主的 `PATH`，再由项目所有者把
`CONTENT_STUDIO_PROJECT` 设置为已确认的 `project.json` 绝对路径：

```bash
corepack enable
pnpm install
pnpm build
pnpm link --global
export CONTENT_STUDIO_PROJECT=/absolute/path/to/project.json
content-studio doctor --project "$CONTENT_STUDIO_PROJECT"
```

MCP 宿主只转发变量名，不把项目清单、凭据或渠道授权写进插件包。也可以绕过插件
配置，显式运行：

```bash
content-studio mcp --stdio --project /absolute/path/to/project.json
```

项目清单可由下面两条命令起草；登记或使用前仍须由项目所有者确认：

```bash
content-studio project import --source /absolute/source/dir --out project.json
content-studio project init --name "My Site" --project-id my-site \
  --url https://example.com --out project.json
```

公开 Plugins Directory 版本还需要版本化安装器或已注册的生产 MCP 连接；在这些
交付物完成前，本仓库不会声称安装插件会自动创建项目清单或安装本地运行时。

## 安全边界

- 插件安装不会授予渠道发布权限。
- Content Studio 不读取或传递 token、cookie、密码、浏览器配置或支付数据。
- 外部写入仍由独立、匹配授权的 `marketing-ops` 运行时负责。
- `${CONTENT_STUDIO_PROJECT}` 只指向项目所有者明确确认的本地清单。
