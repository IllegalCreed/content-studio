---
name: review-and-handoff
description: 对已完成内容审稿和成品确认的 Content Studio 活动建立发布计划，准备渠道人工接管，完成 Owner 登录、验证码或最终发布确认后的回执，并按明确选择晋升产物。当活动进入发布协作、渠道阻塞、人工接管、回执确认或素材晋升时使用；不用于代替内容创作审稿。
---

# 发布协作与人工接管

## 1. 验证上游确认门

先读取活动、渠道内容、制作任务和产物的持久状态。只有当前内容版本与最终成品都已明确
确认，才调用 `create_publication_plan`。状态缺失、版本已变化或仍有制作任务未完成时，
返回 `produce-activity`，不得用发布动作代替审稿。

## 2. 刷新 Marketing Ops 状态

调用 `get_marketing_ops_channels_status` 读取当前项目的新鲜只读快照。runtime 未连接、
快照过期或目标渠道不是 `ready` 时停止发布协作并如实报告；`adapterReady` 和快照中的
`authorizesExternalWrite: false` 都不能替代用户对当前活动的明确授权。

## 3. 准备 Marketing Ops 发布包

renderer 已生成渠道包元数据时，先调用 `prepare_marketing_ops_package` 做本地只读校验。
只提交项目、发布安排和 renderer 元数据；不要提交账号引用、本地路径或凭据。返回的
`prepare-only` 结果不代表已授权、已调用渠道或已发布，也不会创建发布回执。

## 4. 准备并等待人工接管

需要人工确认时调用 `create_owner_handoff`，只保存校验和、清单和官方页面地址，不保存
任何凭据。任务进入 `input_required` 后，把交接对象和所需动作展示给用户并停止推进。

用户在官方页面自行完成登录、验证码、风控、2FA 和最终发布确认。不要索取凭据或验证码，
不要替用户点击最终发布。

## 5. 确认接管与回执

用户明确确认后调用 `confirm_owner_takeover`，只继续与当前活动、版本和交接匹配的会话。
渠道状态和发布结果必须来自新鲜 `marketing-ops` 快照或严格匹配的回执；Workbench 本地
状态不能授予或扩大外部写权限。

## 6. 晋升产物与监测

用户明确选择后调用 `promote_activity_artifact`，把活动产物登记为项目素材且保留原产物。
发布回执存在后再建立监测任务；无受审采集能力时显示 unavailable，不推测浏览量、评论或
删除状态。

## 边界

- 不在本 Skill 中改写正文、视频脚本或分镜；这类反馈返回 `produce-activity` 并创建新版本。
- 绝不自动发布、绕过人工确认或收集密码、Cookie、Token。
- 相同请求的重试必须复用持久状态和幂等身份，不凭对话内容猜测已发布。
