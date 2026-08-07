---
name: produce-activity
description: 端到端制作发布活动：创建活动、保存内容组和渠道版本、启动制作任务并跟踪进度。当用户要求为某项目创作文章、图片或视频内容，或推进制作任务时使用。
---

# 制作发布活动

## 1. 确认项目作用域

先调用 `get_project_view` 取得 `projectId` 和项目现状。所有工具都带
`projectId`，以快照中的值为准。

## 2. 创建发布活动

调用 `create_publishing_activity` 创建活动，得到 `activityId`。

## 3. 保存内容

- 主题内容组：`create_content_group`；
- 一次保存多组内容与多个渠道版本：`save_activity_content_pack`；
- 只保存单个渠道版本：`save_channel_content`。

这些工具只保存内容，不会发布到渠道。

## 4. 准备视频拍摄计划

视频类任务先调用 `get_activity_video_plan` 读取版本化拍摄计划，再启动录制。

## 5. 启动制作任务

调用 `start_production_task` 启动任务。视频任务由本地执行器异步录制，文章任务
等待对应生成器；此工具不会执行渠道发布。不要对同一任务并发重复启动。

## 6. 跟踪与处理失败

- `list_project_tasks` 列出项目任务，`get_task` 读取单条任务和追加式事件；
- 状态映射：`working`（执行中）、`input_required`（等待人工）、`completed`、
  `failed`、`cancelled`；
- 失败先用 `get_task` 定位原因，再用 `retry_task` 创建新尝试（保留旧事件）；
- 进入 `input_required` 时停止继续执行，转用 `review-and-handoff`。

## 边界

本流程任何一步都不会触发渠道发布；不接收凭据；发布安排和人工确认必须走
`review-and-handoff`。
