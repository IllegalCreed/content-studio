# 开源、本地优先与安装分发

> 状态：产品分发决策
> 最近评审：2026-07-30

## 决策

Content Studio 采用**开源、本地优先、云端可选**的产品形态。

默认情况下，项目源码、项目事实、素材、活动产物、浏览器执行、Playwright
录制、FFmpeg 合成和发布运行时都位于用户自己的设备或自托管环境。公开服务只在
进入 ChatGPT/Codex Plugins Directory、跨设备协调或用户主动选择托管能力时
参与。

目标用户体验收敛为：

```text
一条命令安装 Content Studio 本地运行时
        ↓
一次安装 Content Studio Plugin
        ↓
第一次使用时确认项目目录和项目能力
        ↓
开始 AI 创作、制作、发布协作和监测
```

开源本地版不是云端版的降级演示。除需要公共宿主入口或托管资源的功能外，它应能
完成完整的项目管理、AI 协作、内容制作、人工接管和报告工作流。

## 安装体验目标

最终 README 面向普通用户提供一个版本化安装入口。命令形态为：

```bash
curl -fsSL <versioned-install-url> | sh
content-studio doctor
```

安装地址在正式发布前保持占位，不能在产物尚未发布时伪造可用命令。README 同时
提供下载、校验、检查后再执行的审慎安装路径，以及从源码使用 pnpm 构建的开发者
路径。

安装器交付一个统一的 Content Studio 本地运行时，而不是要求用户手工维护多个
仓库和服务。目标组成包括：

```text
Content Studio local runtime
├─ content-studio CLI
├─ core 和控制面应用服务
├─ 本地 MCP Server
├─ Vue 工作台
├─ 本地元数据存储
├─ Playwright 录制 Worker
├─ FFmpeg 合成边界
└─ 受管的 marketing-ops 运行时依赖
```

本地 MCP 默认通过 `stdio` 或只绑定 `127.0.0.1` 的 HTTP 端点运行。安装器不得
默认向公网开放端口。

### 安装器安全要求

- 发布物必须版本化，并提供校验和或签名验证。
- 默认安装到用户范围的窄目录，不默认要求 `sudo`。
- 支持幂等重复执行、明确升级、健康检查和可恢复卸载。
- 提供 `--dry-run` 或等价的变更预览能力。
- 不读取、回显或迁移 token、cookie、密码、Keychain 值或浏览器 profile。
- 不扫描或注册任意项目目录；首次项目访问必须由用户明确选择和确认。
- 不自动修改目标项目源码。项目内适配器仍需项目所有者单独许可和评审。
- 卸载不得删除未知文件；项目产物、发布回执和配置的保留或移除必须明确确认。

`curl | sh` 是便捷入口，不是唯一入口。用户必须能够先下载脚本、查看内容、验证
发布物，再单独执行。

## Plugin 与本地运行时

用户只需要安装一个面向 ChatGPT/Codex 的 **Content Studio Plugin**，不需要再
单独寻找或安装一个 `marketing-ops` Plugin。

Content Studio Plugin 负责：

- 提供文章、图片、视频方案、活动推进、审核和复盘 Skills；
- 注册 Content Studio MCP 连接；
- 声明 MCP App UI resources；
- 引导项目注册、任务观察和人工接管；
- 通过 Content Studio 应用服务使用发布能力，不直接绕过应用服务调用渠道。

本地开发和自托管分发可以通过 Plugin 的本地 MCP 配置启动
`content-studio mcp --stdio`。Plugin 安装不应复制 core、任务状态机或发布逻辑。

公开目录中的 MCP Plugin 仍需要可供审核访问的公网生产 MCP URL。因此公开市场
形态需要一个轻量入口，但该入口不应承担默认的浏览器和媒体计算：

```text
ChatGPT/Codex 公共 Plugin
            │
            ▼
轻量公网 MCP 入口和 UI resources
            │
            ▼
经用户明确确认的本地 Content Studio runtime
            │
            ├─ 项目、素材和本地存储
            ├─ Playwright / FFmpeg Worker
            └─ marketing-ops
```

公网入口与本地运行时之间的连接协议必须单独威胁建模。任何设备确认、身份或连接
材料都不能通过模型提示、MCP 工具参数、日志或项目文件传递。连接方案在完成安全
设计和测试前不得写成已经实现。

## `marketing-ops` 的依赖与信任边界

`marketing-ops` 是 Content Studio **默认随附的受管运行时依赖**，同时继续保持
独立的代码、发布、存储和权限边界。

“随附”意味着：

- Content Studio 安装器安装经过兼容性验证的 `marketing-ops` 版本；
- `content-studio doctor` 检查其版本、健康和能力状态；
- Content Studio 升级流程检查兼容矩阵并协调升级；
- 用户只安装一个 Content Studio Plugin；
- 未配置任何渠道时，内容生成和本地制作仍然可用，发布能力明确显示为未配置。

“独立边界”意味着：

- `marketing-ops` 保持独立仓库、包和运行进程或 MCP 服务；
- Content Studio 不复制渠道适配器，不直接执行真实渠道写入；
- 两者不共享凭据存储，也不通过 MCP 传递凭据或浏览器会话；
- `marketing-ops` 的项目档案、渠道策略和发布回执仍是外部写入事实来源；
- Content Studio 只保存经过验证的状态与回执投影，不能用本地 UI 状态授予权限；
- 安装、启动、项目注册、内容生成或人工接管都不构成发布授权。

所有发布调用必须包含稳定 `projectId`，写入前读取对应项目的最新渠道状态。真实
发布、回复和删除仍要求当前活动与渠道相匹配的明确授权，并在重试时保持活动 ID
和幂等键。没有匹配且持久化的公开回执时，Content Studio 不能显示发布成功。

渠道登录、验证码、2FA、审核和最终点击继续由渠道授权人在官方平台界面完成。
渠道配置只能通过 `marketing-ops` 提供的本地交互式流程进行，不能把凭据放入
Content Studio、Codex 对话、MCP 参数、日志或仓库。

## 部署形态

| 形态                 | 主要用途                     | 计算与数据位置                     | 公网要求               |
| -------------------- | ---------------------------- | ---------------------------------- | ---------------------- |
| 本地自托管           | 个人、开源用户、项目内使用   | 全部位于用户设备                   | 无                     |
| 私有服务器自托管     | 团队或长期运行               | 用户自己的服务器与可选本地 Worker  | 由用户决定             |
| 公共 Plugin + 本地端 | Plugins Directory 与本地制作 | 轻量入口在公网，制作和素材默认本地 | 公网 MCP 生产 URL      |
| 可选托管服务         | 团队协作、托管 Worker 和报告 | 用户明确选择的托管环境             | 由 Content Studio 提供 |

当前自有 2 vCPU、约 2 GiB 内存的服务器只计划承担轻量公网 MCP 入口、UI resources
和有限元数据服务。默认媒体制作不依赖升级该服务器；Playwright、FFmpeg 和后台
AI Worker 优先使用用户本机或独立 Worker。

## 开源仓库边界

目标发布结构保持小而清晰：

```text
content-studio
├─ core
├─ application services
├─ mcp-server
├─ workbench
├─ worker
├─ recorder-playwright
├─ composer-ffmpeg
├─ adapter-sdk
└─ installer and deployment assets

marketing-ops
└─ independently versioned managed dependency
```

开源许可证需要在首个公开分发版本前单独决策。许可证选择不能改变本地优先、安全
边界、用户数据归属或 `marketing-ops` 的独立授权责任。

## 首版交付验收

- 新用户能从一条公开安装命令得到可运行的本地 runtime。
- 安装器发布物可验证、可重复安装、可升级、可诊断、可安全卸载。
- `content-studio doctor` 能区分已安装、已就绪、未配置和被策略阻塞。
- 用户只需安装一个 Content Studio Plugin。
- 第一次项目访问要求明确选择项目并确认允许的能力。
- 本地使用不要求购买 Content Studio 托管服务器。
- `marketing-ops` 随安装器交付，但没有渠道配置和匹配授权时保持 fail closed。
- 公共 Plugin 的远程入口可以独立于本地媒体 Worker 扩容和失败恢复。
- 源码开发继续只使用 pnpm，不引入 npm 或 yarn 工作流。
