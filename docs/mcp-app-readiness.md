# MCP App 与公开上架准备

> 状态：产品与部署基线
> 最近评审：2026-07-30

## 目标

Content Studio 的发布目标不是“提供一个带 MCP 接口的独立后台”，而是成为首批
面向 ChatGPT/Codex 公共目录上架的 AI 内容生产应用之一。

项目同时采用开源、本地优先形态。公共目录是 AI 宿主入口，本地 runtime 才是
项目、素材、浏览器和媒体制作的默认执行环境；用户不需要购买托管服务才能运行
完整个人工作流。

面向 OpenAI 生态时，正式可发现、安装和发布的分发单位遵循 **OpenAI Plugin**
目录约定（`.codex-plugin/plugin.json` + `skills/` + `.mcp.json`）。**MCP Apps UI** 是客户端命名
空间扩展：开放标准负责让 MCP Server 返回交互式 UI，但 UI 不在 Agent Plugins
可移植契约内。Content Studio 的目标包形态为：

```text
Content Studio Plugin
├─ .codex-plugin/plugin.json
├─ skills/
│  ├─ 接入项目（onboard-project）
│  ├─ 制作发布活动（produce-activity）
│  └─ 发布协作与人工接管（review-and-handoff）
├─ .mcp.json（本地 stdio 运行时）
└─ com.openai.*（可选）MCP App UI 客户端命名空间扩展
   ├─ 行内活动与任务卡片
   ├─ 内容审核和资源对比
   └─ 全屏活动工作台与报告

Content Studio local runtime
├─ core、应用服务、本地 MCP 和工作台
├─ Playwright / FFmpeg Worker
└─ 随附但保持独立的 marketing-ops
```

OpenAI 当前文档已经提供 Plugin 公共提交、审核、批准和发布流程。批准并由开发者
发布后，Plugin 会进入 ChatGPT 与 Codex 共用的 Plugins Directory。因此项目不再
把“应用市场开放”当作不确定的远期前提，而是立即按公开上架要求建设。

官方依据：

- [OpenAI Plugin 架构](https://developers.openai.com/plugins/concepts/plugins)
- [OpenAI Plugin 提交和发布](https://developers.openai.com/plugins/deploy/submission)
- [OpenAI MCP Server 审核要求](https://developers.openai.com/plugins/deploy/app-review)
- [OpenAI MCP App UI 指南](https://developers.openai.com/plugins/build/chatgpt-ui)

## 与小程序生态的关系

“类似微信小程序生态”是方向正确的类比：

| MCP/OpenAI 生态       | 小程序类比                         |
| --------------------- | ---------------------------------- |
| ChatGPT/Codex         | 宿主和分发入口                     |
| Agent Plugin          | 可发现、安装和审核的应用包         |
| MCP Server            | 应用后端和受控能力接口             |
| MCP App UI            | 客户端命名空间扩展内的交互页面     |
| Skills                | 应用随附的标准操作方法和工作流说明 |
| Tools/Resources/Tasks | 应用 API、数据资源和异步任务协议   |

二者的重要区别是：MCP 应用由 AI 理解意图并主动选择工具，UI 不是唯一入口。所有
核心工具必须在没有 UI 时也能完成 headless 工作流；UI 只在检查、比较、编辑、
确认、预览和监测等场景提供更高效的人机界面。

## 本地安装与公共目录双路径

本地开发或自托管时，Content Studio Plugin 可以通过本地 MCP 配置启动
`content-studio mcp --stdio`，也可以在需要 HTTP 传输的宿主中启动仅绑定回环地址的
`content-studio mcp --http`。目标用户流程为“一条命令安装本地 runtime、一次
安装 Content Studio Plugin、第一次使用时确认项目范围”。

公共 Plugins Directory 中的 MCP Server 必须使用公网生产 URL，因此公开版本
保留一个轻量、无状态的 MCP 入口和版本化 UI resources。该入口默认不保存项目
源码或原始素材，也不执行 Playwright、FFmpeg 或渠道登录。

本地 runtime 默认包含固定兼容版本的 `marketing-ops`。用户不安装第二个
`marketing-ops` Plugin；Content Studio 通过独立、有类型的账号引用与发布上下文边界
调用它。兼容期可以附带 Content Studio `projectId` 作为技术隔离句柄，但这不把
Content Studio 的项目、活动和素材交给 `marketing-ops` 管理。随附安装、健康检查和
渠道就绪都不能代替当前活动对应的外部写入授权。

完整安装器、安全与部署形态见
[开源、本地优先与安装分发](local-first-distribution.md)。

## 协议目标：MCP 2026-07-28

Content Studio 的远程 MCP Server 以 `2026-07-28` 为首选协议版本，并为实际需要
的旧客户端提供明确、经过测试的兼容策略。

[MCP 2026-07-28 变更说明](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
确认了以下基础变化：

- 协议层不再使用 `initialize`/`initialized` 握手；
- Streamable HTTP 不再使用 `Mcp-Session-Id`；
- `server/discover` 用于发现版本、能力和身份；
- 客户端能力、协议版本和身份随请求显式传递；
- 跨调用状态通过服务端生成的显式句柄传递；
- 工具和资源列表支持明确缓存范围和过期时间；
- MCP Apps 与 Tasks 通过正式扩展框架独立演进。

协议无状态不等于 Content Studio 业务无状态。业务状态继续持久化在应用服务中，
并通过以下不可猜测、可授权、可审计的句柄显式引用：

```text
projectId
activityId
contentId
artifactId
taskId
handoffId
receiptId
```

任何工具调用都必须从当前授权上下文校验句柄归属，不能因为调用者知道一个 ID 就
获得跨项目访问能力。

## MCP Apps UI

[MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) 允许 MCP
Server 把交互式 HTML 作为 UI resource 返回，由宿主在沙箱 iframe 中渲染。UI
通过基于 `postMessage` 的 JSON-RPC bridge 与宿主通信。在 Agent Plugins 包中，
这部分内容位于客户端命名空间目录（如 `com.openai.*/`）或 `extensions` 字段下，
其他客户端忽略它，不影响可移植的 Skills 与 MCP Server。

Content Studio 的 Vue 3 工作台继续复用，但按使用场景拆成可嵌入界面：

- 行内卡片：活动摘要、需要审核的内容、人工接管和任务结果；
- 较大视图：文章修订比较、图片选择、视频脚本和预览；
- 全屏工作台：项目内完整活动、任务和报告控制面。

实现要求：

- 优先使用开放 MCP Apps 字段和 `ui/*` bridge；
- 保持 MCP App UI 为客户端命名空间扩展，可移植内核只有 Skills 和 MCP Server；
- 仅在共享标准不覆盖时 feature-detect ChatGPT 扩展；
- 工具在不渲染组件时仍然可用；
- UI resource 使用版本化 URI，破坏性 UI 更新生成新 URI；
- CSP 只允许实际需要的精确 origin；
- UI 不直接遍历本地文件、修改任务状态或扩大渠道权限。

## MCP Tasks 映射

[MCP Tasks](https://modelcontextprotocol.io/extensions/tasks/overview) 为长时间
工具调用提供持久句柄、轮询、中途输入、结果获取和协作式取消。

Content Studio 保留更细的内部流水线状态，同时通过适配器映射为 MCP Tasks：

| Content Studio 内部状态                                    | MCP Task 状态    |
| ---------------------------------------------------------- | ---------------- |
| `queued`、`generating`、`recording`、`composing`、监测执行 | `working`        |
| `awaiting-owner`                                           | `input_required` |
| `completed` 或已有成功发布回执                             | `completed`      |
| 当前尝试失败                                               | `failed`         |
| 当前尝试取消                                               | `cancelled`      |

任务适配器应实现 `tasks/get`、`tasks/update` 和 `tasks/cancel`，并在宿主支持时通过
任务通知推送完整状态；默认始终支持轮询回退。

本地实现遵循扩展的标准形状：只有逐请求声明
`io.modelcontextprotocol/tasks` 的宿主才会收到 `resultType: "task"`；`tasks/get`
使用单个 `taskId` 返回完整 Task、待输入请求或终态结果，`tasks/update` 只提交与
`inputRequests` 对应的 `inputResponses`，`tasks/cancel` 返回空确认并协作式取消。
MCP Server 已由启动配置绑定项目，领域事件和重试历史继续通过 `get_task`、
`retry_task` 读取和推进，不复用 `tasks/update` 做事件游标轮询。

内容创作第一版使用 `save_activity_content_pack`：模型由 MCP 宿主调用和托管，Content
Studio 只接收结构化的文章/视频版本，做项目范围、活动渠道、语言、重复版本和敏感字段
校验，然后保存到本地应用服务。这样不会把某个模型供应商或 API 密钥写进 core。

`start_production_task` 会先推进本地制作任务的 `queued → generating`，作为 Worker 消费
任务的明确入口。当前本地 HTTP Runtime 和 `content-studio mcp --stdio` 都接入同一个单并发
Worker：视频任务会自动消费该状态，调用
应用服务的 `runProductionTask`，并根据真实录制与合成回执推进
`recording → composing → completed` 或结束当前尝试；文章任务仍等待独立的 AI/文本执行器。外部渠道操作仍保持在独立的
`marketing-ops` 信任边界内。

核心层现在提供 `runProductionTaskWithPlaywright` 这个明确绑定：调用方给出项目预览
origin、编译好的 `VideoPlan` 和窄输出目录后，才会调用内置录制器。它不读取凭据、不扫描
项目目录，也不接受任意脚本或选择器；Worker 调度和项目预览适配器仍由本地 runtime 负责。

发布活动可以附带可选的视频计划（项目 capture flow ID 和画幅）。应用服务会在保存活动时
确认 flow 属于该项目快照，并在 Worker 侧编译成 `VideoPlan`；没有视频计划的文章活动不受
影响。按活动运行制作任务时，Worker 只接收任务编号和预览/输出边界，由应用服务从任务
所属活动读取计划。

本地 HTTP Runtime 的 `POST /api/v1/projects/:projectId/tasks/:taskId/record` 已接入这条
路径：请求只提供无凭据的 `baseUrl` 和 `projectOrigin`，输出目录由 Runtime 固定生成；
工作台的自动 Worker 和兼容“手动录制”操作都不会接收脚本、选择器或任意文件路径。

本地 HTTP 工作台复用同一个控制面，排队中的视频制作任务调用项目范围的 `start` 路由后
进入 `generating`，由 Runtime Worker 自动排队录制；任务取消、重试和事件查询仍走同一份
任务存储。Worker 只使用快照派生的无凭据 origin 和固定输出目录，不接受脚本、选择器或
凭据。为避免启动服务时意外执行，遗留的 `generating` 任务暂不自动恢复。

MCP stdio 使用同一个队列边界：CLI 启动时创建本地 Worker，`start_production_task`、
`retry_task` 和 `tasks/cancel` 会分别入队、重新入队或中止对应视频任务；Worker 停止时会
中止未完成的本地尝试。关闭或重启不会自动恢复遗留的 `generating` 任务，避免用户未确认时
意外打开浏览器。

MCP Tasks 没有 `tasks/list`。全局和项目任务面板必须继续使用经过业务授权的领域
查询，例如：

```text
list_global_tasks(filters)
list_project_tasks(projectId, filters)
get_content_studio_task(taskId)
```

这些领域查询与 MCP Tasks 的单任务句柄协议不是同一个数据层。

## 不采用的新协议能力

`2026-07-28` 已把 Roots、Sampling 和 MCP Logging 标记为弃用。Content Studio
不把新实现建立在这些能力上：

- 项目和素材范围通过工具参数、资源 URI 和服务端配置表达，不依赖 Roots；
- 交互式创作由 MCP 主机中的 AI 调用工具完成；
- 脱离对话的后台 AI 生成使用宿主任务机制或独立 AI 执行器，不依赖 Sampling；
- 应用日志写安全摘要和 OpenTelemetry，不依赖 MCP Logging。

模型或渠道凭据由外部部署/授权系统管理，不进入项目清单、MCP 参数、产物、日志
或本仓库。

## 公开上架检查表

### 发布主体和公共材料

- [ ] 确定以个人还是企业身份发布并完成对应验证。
- [ ] 确认提交组织具有 Apps Management 写权限。
- [ ] 准备产品名、短描述、长描述、Logo、分类和国家/地区范围。
- [ ] 建立公开官网、支持页面、隐私政策和服务条款。
- [ ] 为商店首页准备清晰、真实的 starter prompts。

### MCP Server

- [ ] 部署公网生产 MCP URL，不使用本地或测试 endpoint 提交。
- [ ] 完成域名验证、TLS、健康检查、限流和审计。
- [ ] 实现公共服务的 `server/discover` 和 `2026-07-28` 无状态请求路径。
      本地 `content-studio mcp --stdio` 已完成第一条项目范围切片，公共入口仍待实现。
- [ ] 工具名、描述、输入/输出 schema 和实际行为一致。
- [ ] 为每个工具准确标注 `readOnlyHint`、`openWorldHint` 和
      `destructiveHint`。
- [ ] 工具响应不包含凭据、调试载荷、内部标识或未披露个人数据。
- [ ] MCP UI 使用精确 CSP 和版本化 UI resource URI。
- [ ] 发布新 MCP 元数据快照前重新扫描、审核和发布。

### 本地 runtime 与安装器

- [ ] 发布可验证、版本化、默认不要求 root 的安装器。
- [ ] 提供下载后检查再执行的替代安装路径。
- [x] 本地 MCP 只使用 `stdio` 或绑定 `127.0.0.1`；当前实现为 `stdio` 和无状态
      Streamable HTTP，HTTP 默认使用 `11002`。
- [ ] `content-studio doctor` 检查 core、工作台、Worker 和
      `marketing-ops` 的版本与健康。
- [ ] `marketing-ops` 随安装器交付但保持独立存储和授权边界。
- [ ] 安装器不扫描项目、不迁移凭据、不自动配置渠道。
- [ ] 项目目录、项目内适配器和本地 Worker 连接都要求用户明确确认。

### 审核用例

- [ ] 至少准备 5 个可重复的正向测试。
- [ ] 至少准备 3 个拒绝、澄清或安全降级的负向测试。
- [ ] 审核 fixture 不依赖内部网络。
- [ ] 如公共服务需要登录，由发布者直接在官方提交入口配置隔离演示账号；任何
      演示凭据都不得写入仓库、文档或交给 Content Studio/Codex。

首批正向用例优先覆盖：

1. 从项目事实创建一次发布活动；
2. 为不同渠道生成独立文章与视频方案；
3. 生成图片或封面并在 UI 中比较；
4. 启动录制任务，查看进度并安全取消/重试；
5. 从发布回执和数据快照生成活动复盘。

首批负向用例优先覆盖：

1. 拒绝没有匹配授权的真实渠道发布；
2. 拒绝读取、保存或回显渠道凭据；
3. 拒绝登录、验证码或 CAPTCHA 自动化；
4. 拒绝任意 Shell、脚本和选择器；
5. 拒绝跨项目读取未授权素材或任务。

## 现有服务器基线

2026-07-30 对 Algorithm Visualizer 自有域部署服务器进行了经用户授权的只读
检查，没有部署、重启或修改任何远程状态。

当前确认：

- Alibaba Cloud Linux 3，2 vCPU；
- 约 1.8 GiB 内存，检查时可用约 567 MiB，无 swap；
- 根磁盘 40 GiB，已使用约 64%；
- Nginx 和 HTTPS 正常，Algorithm Visualizer 公网首页返回 200；
- Node.js 24.12.0、PM2 6.0.14 可用；
- 服务器 pnpm 为 10.27.0，Content Studio 部署必须通过 Corepack 固定到仓库要求
  的 pnpm 10.29.2；
- Docker 当前未运行；
- Algorithm Visualizer 仍是 Nginx 直接提供的静态站，部署目录约 14 MiB，包含
  191 个 HTML 文件和上一版本备份。

该服务器证明现有域名、TLS、Nginx 和 Node 运行基础可复用，适合先部署轻量的
Content Studio MCP API、UI resources 和小规模元数据服务。采用本地优先形态后，
它不需要为每个用户承担默认的 Playwright、FFmpeg 或 `marketing-ops` 运行成本。

但当前可用内存有限且没有 swap，不应直接把并发 Playwright、FFmpeg 和后台 AI
生成全部放在同一台机器。生产拓扑优先拆分为：

```text
公网域名与 Nginx
        │
        ▼
无状态 Content Studio MCP API
        │
        ├─ 项目/活动/任务/素材元数据存储
        ├─ MCP App UI resources（客户端命名空间扩展）
        └─ 受控任务队列
                  │
                  ▼
        经用户确认的独立或本地 Worker
        Playwright / FFmpeg / AI / marketing-ops
```

公网 MCP 服务正式启用前还需要：

- 独立非 root 服务用户和窄目录；
- 独立域名或明确路由、TLS 和反向代理；
- PM2 或 systemd 托管、启动恢复和资源限制；
- 健康/就绪检查、限流、备份和 OpenTelemetry；
- 项目级身份授权和句柄访问校验；
- 对轻量 API 与媒体 Worker 分别做容量测试。

本次检查只确认基础设施可用性，不授权部署 Content Studio，也不授权任何渠道
发布或外部写入。
