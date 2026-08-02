# Content Studio

Content Studio 是开源、本地优先、跨项目、AI 原生的内容生产与发布控制台。它以
MCP App 为主要交互边界：AI 读取版本化项目事实和发布活动简报，生成文章、图片、
视频脚本及不同渠道版本，再通过可观察、可取消、可重试的任务完成录制和后续媒体
制作。

Vue 3 工作台是同一套 Content Studio core 和应用服务的可视化控制面，不在浏览器
应用中复制生成、录制、合成或发布逻辑。

真实渠道发布不属于本仓库。Content Studio 只准备发布内容、协调人工接管并展示
回执；独立的 `marketing-ops` 负责匹配授权、渠道策略、外部写入和发布回执。
最终安装器默认把兼容版本的 `marketing-ops` 作为受管运行时依赖一起安装，但
不会因此合并它的代码、存储或发布权限边界。

## 产品结构

```text
全局渠道目录
  → 项目选择启用
    → 发布活动
      → 内容组
        → 渠道内容（文章或视频）
          → 资源变体
          → 发布安排
            → 发布记录
              → 数据监测和报告
```

- 渠道平台和账号目录全局管理，项目决定启用哪些渠道并绑定哪些账号。
- 素材归项目所有，活动产物归具体活动；当前不设置全局素材库。
- 同一发布活动可以为不同平台创作完全不同的内容。
- 图片是可由 AI 独立生成的素材，通常服务于文章、视频或封面。
- 移动端、PC 端、横屏、竖屏等通过渠道要求的资源变体表达。
- 制作、发布、监测是三类执行任务，在全局或项目任务面板中显示，不作为活动
  内部业务模块的名称。

完整层级见[产品功能模块](docs/product-modules.md)。

## 开源、本地优先与安装目标

项目源码、素材、活动产物、Playwright、FFmpeg 和渠道运行时默认保留在用户自己的
设备或自托管环境。公网服务只作为公共 Plugin 的轻量入口、UI resources 和可选
协调层，不是本地使用的前提。

目标用户体验是：

```text
一条命令安装 Content Studio 本地运行时
  → 安装一个 Content Studio Plugin
    → 第一次使用时确认项目目录和允许的能力
      → 开始创作、制作、发布协作和监测
```

正式发布后 README 将提供版本化且可验证的安装脚本，命令形态如下；当前安装器和
公开地址尚未发布，因此这里不提供伪造的可执行 URL。

```bash
curl -fsSL <versioned-install-url> | sh
content-studio doctor
```

本地运行时统一交付 core、应用服务、MCP Server、Vue 工作台、本地存储、
Playwright/FFmpeg Worker 和受管的 `marketing-ops` 依赖。用户只安装一个
Content Studio Plugin；渠道配置仍由用户在 `marketing-ops` 的本地交互流程中
完成，任何凭据都不经过 Content Studio、MCP 参数或对话。

完整决策和安装器安全要求见
[开源、本地优先与安装分发](docs/local-first-distribution.md)。

## 当前实现

V0.1 确定性编译器已经完成。它把小型、版本化项目清单和 campaign brief 编译为：

- 当前 19 渠道的确定性内容包；
- 不授予发布权限的渠道交付分类；
- 使用语义项目交互的确定性视频录制计划；
- 可以移交给独立 `marketing-ops` 的版本化产物。

V0.2 通用 Playwright 录制器已经完成：

- 只消费编译后的语义视频计划；
- 输出标准 JSON 进度事件、日志摘要、预览帧和回执；
- 支持协作式取消和有界重试；
- 每次尝试使用独立目录且不覆盖此前证据；
- 拒绝跨 origin、认证页面、弹窗、下载和非语义选择器。

最小 Vue 3 工作台已经建立。项目概览和发布活动现在可以连接本地应用服务：项目视图
和活动从 SQLite 读取，活动可以通过工作台创建并立即显示，同时生成一个真实的项目制作
任务，任务事件也会在运行时重启后恢复。其他任务类型、素材、人工接管和报告仍有明确
标注的演示投影。制作任务的取消和重试已经通过本地应用服务执行；清理和真实渠道发布
仍保持只读或禁用，直到对应契约接入。

活动详情还可以通过本地应用服务保存内容组和渠道内容版本，按渠道展示文章或视频内容。
当前工作台里的保存表单是 AI/MCP 接入前的手动测试入口，不代表系统已经自动生成内容。

本地 MCP 的第一条切片已经接入。它使用 `stdio` 逐行传输 JSON-RPC，只加载命令行明确
指定的一个项目，不监听端口，也不接收凭据、任意脚本、选择器或文件路径。AI 宿主可以
读取项目事实、活动、内容和任务，并通过高层工具创建发布活动、保存内容组与渠道内容、
读取任务以及取消/重试本地任务。长任务还提供 `tasks/get`、`tasks/update` 和
`tasks/cancel` 的单任务轮询接口。AI 宿主还可以用 `save_activity_content_pack` 一次
保存内容组和多个渠道版本；这些工具不会执行真实渠道发布。

AI 创作是目标产品的核心能力，目前的确定性编译器是安全基础，MCP 是 AI 宿主接入
应用服务的第一步，文章/图片/视频方案生成和后台 AI 执行器按路线图继续实现。

## MCP App 与公开上架目标

Content Studio 将以 Skills、无状态 MCP Server 和 Vue MCP App UI 组成可公开
提交的 Plugin，目标进入 ChatGPT 与 Codex 共用的 Plugins Directory。

远程服务首选 MCP `2026-07-28`，业务状态通过 `projectId`、`activityId`、
`taskId` 等显式句柄和服务端持久化管理；长制作流程映射为 MCP Tasks。没有 UI
时工具仍能完成 headless 工作流，Vue 用于内容审核、资源比较、任务观察和全屏
活动控制。

Algorithm Visualizer 的自有服务器已经通过只读检查确认具备 Nginx、HTTPS、
Node.js 和 PM2 基础，可以作为轻量 MCP API/UI 试运行基础；Playwright、FFmpeg
和后台 AI Worker 需要与低内存公网服务分离。本次检查没有部署或修改服务器。

协议、部署与公开审核检查表见
[MCP App 与公开上架准备](docs/mcp-app-readiness.md)。

## 从源码开发和验证

```bash
corepack enable
pnpm install
pnpm verify
pnpm generate:example
```

示例输出：

```text
.content-studio/example/
├── bundle.json
├── content/
│   ├── bilibili.zh-CN.md
│   ├── github.en.md
│   └── ...
└── video/
    └── plan.json
```

## CLI

对其他项目运行验证和生成：

```bash
pnpm build
node dist/cli.mjs validate \
  --project path/to/project.json \
  --campaign path/to/campaign.json

node dist/cli.mjs generate \
  --project path/to/project.json \
  --campaign path/to/campaign.json \
  --out .content-studio/my-campaign
```

产品层把 Campaign 称为“发布活动”。V0.1 CLI 和数据契约暂时保留
`--campaign`、`campaignId` 等兼容名称。

对明确启动或连接的项目预览执行录制：

```bash
pnpm exec playwright install chromium
node dist/cli.mjs record \
  --project path/to/project.json \
  --campaign path/to/campaign.json \
  --base-url http://127.0.0.1:11000 \
  --out .content-studio/jobs/my-recording \
  --attempts 2
```

录制器发出 JSON 进度事件。每个不可变 `attempt-<n>/` 目录包含隔离 WebM
场景片段、预览帧和机器可读 `receipt.json`。`Ctrl+C` 会协作式取消当前尝试。

启动最小工作台：

```bash
pnpm dev:workbench
```

启动本地应用服务（另一个终端）：

```bash
pnpm build
node dist/cli.mjs serve \
  --project examples/algorithm-visualizer/project.json \
  --campaign examples/algorithm-visualizer/campaign.json \
  --port 11001
```

启动本地 MCP（由支持 MCP 的 AI 宿主启动或在终端中测试）：

```bash
pnpm build
node dist/cli.mjs mcp --stdio \
  --project examples/algorithm-visualizer/project.json \
  --campaign examples/algorithm-visualizer/campaign.json \
  --db .content-studio/content-studio.sqlite
```

`--campaign` 只用于把发布活动中使用的渠道绑定到这个项目；MCP 工具仍会再次校验
项目范围和渠道是否启用。`stdio` 不占用端口，协议输出只写到标准输出，诊断信息不混入
协议流。

本地开发端口从 `11000` 开始分配：`11000` 是 Vue 工作台，后续应用服务使用
`11001`、MCP HTTP 使用 `11002`，MCP `stdio` 不占用端口。工作台使用严格端口模式，
如果端口已被占用会直接报错，不会悄悄换到另一个端口；新增服务继续按这个表顺延。

工作台会通过 `/api` 代理连接 11001 的本地应用服务；服务未启动时自动退回只读演示。
当前 UI 开放“创建发布活动”以及本地制作任务的取消、重试；不会模拟发布或监测成功。

## 项目对接

项目至少提供：

- 当前产品事实、定位和语言；
- 规范网站与仓库 URL；
- 使用 role、label、text 或 test-id 的语义 capture flow。

项目也可以在所有者明确许可后实现一个受信任的窄接口适配器，以准备更准确、
可重复的演示状态。Content Studio 按已注册 adapter ID 调用它；MCP 和公共数据
契约仍不接受任意脚本、Shell 命令、选择器或环境变量。

## 安全边界

Content Studio 不登录渠道、不处理验证码、不保存凭据、不持有浏览器会话，也不
运行任意浏览器脚本或选择器。

对于人工辅助渠道，Content Studio 可以创建“人工接管”，由“渠道授权人”在官方
平台界面完成登录、2FA/CAPTCHA、审核和最终发布点击。只有匹配的
`marketing-ops` 回执才能让控制面显示“已发布”。

内容包、AI 生成结果、预览或人工接管都不会产生发布权限。本仓库不执行未经匹配
授权的真实发布、回复或删除，也不抓取未授权的私有渠道后台。

## 开发

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm coverage
pnpm build
pnpm generate:example
```

包管理器：pnpm 10.29.2。运行时：Node.js 22.5 或更高。项目使用纯 ESM。

相关文档：

- [产品愿景](docs/product-vision.md)
- [产品功能模块](docs/product-modules.md)
- [项目接入模式](docs/project-integration-modes.md)
- [开源、本地优先与安装分发](docs/local-first-distribution.md)
- [MCP App 与公开上架准备](docs/mcp-app-readiness.md)
- [架构](docs/architecture.md)
- [控制面模型](docs/control-plane.md)
- [路线图](docs/roadmap.md)
