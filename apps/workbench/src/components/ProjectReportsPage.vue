<script setup lang="ts">
import type { WorkbenchSnapshot } from '../model'

const props = defineProps<{
  snapshot: WorkbenchSnapshot
}>()

const emit = defineEmits<{
  'open-activity': [activityId: string]
}>()
</script>

<template>
  <section id="reports" class="module-section">
    <div class="section-heading"><div><p class="eyebrow">项目空间 / 发布后监测</p><h2>项目报告</h2></div><span>按活动和渠道查看</span></div>
    <p class="section-intro">报告不是活动里的另一个任务，而是发布回执和后续监测的结果投影。{{ props.snapshot.runtimeConnected ? '下面的数据来自当前项目的发布安排、回执和最新监测观测。' : '连接本地运行时后，这里会替换为真实回执和监测数据。' }}</p>
    <div v-if="props.snapshot.reports.length > 0" class="report-list">
      <article v-for="report in props.snapshot.reports" :key="report.activityId + '-' + report.channel" class="report-card">
        <div class="detail-heading"><div><p class="eyebrow">{{ report.activityTitle }} · {{ report.contentType }} · {{ report.accountAlias }}</p><h3>{{ report.channel }}</h3></div><span class="task-status" :data-status="report.status">{{ report.status }}</span></div>
        <div class="report-metrics"><div v-for="metric in report.metrics" :key="metric.label"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong></div></div>
        <p class="report-note">{{ report.note }}</p>
        <small class="report-last-checked">{{ report.lastChecked }}</small>
        <button type="button" class="report-link" @click="emit('open-activity', report.activityId)">查看所属活动 →</button>
      </article>
    </div>
    <div v-else class="empty-state">当前项目还没有发布安排，完成内容制作后可在这里查看回执和监测数据。</div>
  </section>
</template>
