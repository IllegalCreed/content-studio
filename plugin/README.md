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
`content-studio` 与 `content-studio-host` 可执行文件位于宿主的 `PATH`，再由项目所有者把
`CONTENT_STUDIO_PROJECT` 设置为已确认的 `project.json` 绝对路径。需要渠道绑定和
制作任务时，再显式设置活动简报和状态库路径；这些变量都只是 Owner 控制的本地路径，
不是凭据：

```bash
corepack enable
pnpm install
pnpm build
pnpm link --global
export CONTENT_STUDIO_PROJECT=/absolute/path/to/project.json
export CONTENT_STUDIO_CAMPAIGN=/absolute/path/to/campaign.json
export CONTENT_STUDIO_DB=/absolute/path/to/.content-studio/content-studio.sqlite
content-studio doctor --project "$CONTENT_STUDIO_PROJECT"
```

MCP 宿主只转发变量名，不把项目清单、凭据或渠道授权写进插件包。也可以绕过插件
配置，显式运行：

```bash
content-studio mcp --stdio \
  --project /absolute/path/to/project.json \
  --campaign /absolute/path/to/campaign.json \
  --db /absolute/path/to/.content-studio/content-studio.sqlite
```

`CONTENT_STUDIO_PROJECT` 是必需的项目范围；`CONTENT_STUDIO_CAMPAIGN` 只登记该项目
已启用的渠道，`CONTENT_STUDIO_DB` 固定跨宿主会话复用的本地状态位置。缺少 campaign
时只读项目事实仍可用，但需要渠道绑定的内容与制作工具会 fail closed。
`get_marketing_ops_channels_status` 也只在受管 `marketing-ops` MCP client 已由本地
Runtime 注入时可用；否则它返回阻塞状态，不会自动发现命令、读取凭据或扩大发布权限。
宿主若通过 `MarketingOpsManagedRuntime` 注入该 client，CLI 会在本次命令结束时幂等关闭
受管连接；Plugin 本身不携带进程路径、账号配置或凭据。

插件配置实际启动的是 `content-studio-host mcp --stdio`。它只保留上面的三个
`CONTENT_STUDIO_*` 路径变量，不读取任何 `marketing-ops` 命令或路径变量。当前源码发行物
还没有安装器签名/内置摘要所信任的受管 runtime 制品；host 因此不会查找或启动替代进程，
状态工具继续安全地显示为阻塞。

`produce-activity` 把 Agent 对话定义为内容草案、视频脚本、分镜和成品确认的主入口；
MCP 保存版本、确认门、任务与产物，Workbench 只负责随时查看这些投影。内容与成品尚未
分别确认时，Skill 会阻止创建发布计划。渠道登录、验证码和最终发布确认则由
`review-and-handoff` 保持为 Owner 人工步骤。

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
- `${CONTENT_STUDIO_PROJECT}`、`${CONTENT_STUDIO_CAMPAIGN}` 和
  `${CONTENT_STUDIO_DB}` 只指向项目所有者明确确认的本地路径。
