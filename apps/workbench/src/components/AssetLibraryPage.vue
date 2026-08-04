<script setup lang="ts">
import AssetPreview from './AssetPreview.vue'
import type {
  ActivityArtifactProjection,
  AssetProjection,
  WorkbenchSnapshot,
} from '../model'
import type {
  ProjectAsset,
  StorageCleanupPreview,
  StorageCleanupResult,
  StorageRecycleEntry,
} from '@content-studio/core-types'

type AssetFilter = '全部' | AssetProjection['kind']

const props = defineProps<{
  assetFilter: AssetFilter
  assetPromotionError: string | null
  assetPromotionPending: string | null
  filteredAssets: AssetProjection[]
  formatStorageBytes: (bytes: number) => string
  isArtifactPromoted: (artifact: ActivityArtifactProjection) => boolean
  projectAssetKindForArtifact: (artifact: ActivityArtifactProjection) => ProjectAsset['kind'] | null
  runtimeConnected: boolean
  selectedAsset: AssetProjection
  snapshot: WorkbenchSnapshot
  storageCleanupArmed: boolean
  storageCleanupError: string | null
  storageCleanupPending: boolean
  storageCleanupResult: StorageCleanupResult | null
  storagePreview: StorageCleanupPreview | null
  storagePreviewError: string | null
  storagePreviewLoading: boolean
  storagePreviewOpen: boolean
  storageRecycleEntries: StorageRecycleEntry[]
  storageRestoreError: string | null
  storageRestorePending: string | null
}>()

const emit = defineEmits<{
  'promote-artifact': [artifact: ActivityArtifactProjection]
  'confirm-cleanup': []
  'restore-recycle': [recycleId: string]
  'select-asset': [assetId: string]
  'select-artifact': [activityId: string]
  'set-filter': [filter: AssetFilter]
  'toggle-cleanup-preview': []
}>()
</script>

<template>
  <section id="assets" class="module-section">
    <div class="section-heading">
      <div><p class="eyebrow">项目空间 / 可复用素材</p><h2>项目素材库</h2></div>
      <span>{{ props.snapshot.projectAssets.length }} 个项目素材 · {{ props.snapshot.activityArtifacts.length }} 个活动产物</span>
    </div>
    <p class="section-intro">这里管理真正属于项目的文件。活动只引用这些素材；活动生成的文章、图片、预览帧和视频默认留在活动产物中。</p>
    <div class="storage-grid">
      <div class="storage-card storage-card-highlight"><span>项目素材</span><strong>{{ props.snapshot.projectAssets.length }} 个</strong><small>Logo、模板、字体和品牌素材</small></div>
      <div class="storage-card"><span>活动产物</span><strong>{{ props.snapshot.activityArtifacts.length }} 个</strong><small>文章、预览帧、片段和资源变体</small></div>
      <div class="storage-card"><span>占用空间</span><strong>{{ props.snapshot.storage.projectSize }}</strong><small>其中缓存 {{ props.snapshot.storage.cacheSize }}</small></div>
    </div>
    <div class="asset-filter-bar" role="tablist" aria-label="素材类型">
      <button type="button" :class="{ active: props.assetFilter === '全部' }" @click="emit('set-filter', '全部')">全部</button>
      <button type="button" :class="{ active: props.assetFilter === 'logo' }" @click="emit('set-filter', 'logo')">Logo</button>
      <button type="button" :class="{ active: props.assetFilter === 'font' }" @click="emit('set-filter', 'font')">字体</button>
      <button type="button" data-asset-filter="template" :class="{ active: props.assetFilter === 'template' }" @click="emit('set-filter', 'template')">模板</button>
      <button type="button" :class="{ active: props.assetFilter === 'image' }" @click="emit('set-filter', 'image')">图片</button>
    </div>
    <div class="asset-library-layout">
      <div class="asset-list" role="list" aria-label="项目素材列表">
        <button v-for="asset in props.filteredAssets" :key="asset.assetId" type="button" :data-asset-id="asset.assetId" :class="{ selected: asset.assetId === props.selectedAsset.assetId }" @click="emit('select-asset', asset.assetId)">
          <span class="asset-kind">{{ asset.kind }}</span>
          <strong>{{ asset.name }}</strong>
          <small>{{ asset.version }} · {{ asset.size }} · {{ asset.source }}</small>
        </button>
      </div>
      <article class="asset-detail-card">
        <div class="detail-heading"><div><p class="eyebrow">选中项目素材</p><h3>{{ props.selectedAsset.name }}</h3></div><span class="asset-count">{{ props.selectedAsset.version }}</span></div>
        <dl class="asset-detail-list">
          <div><dt>类型</dt><dd>{{ props.selectedAsset.kind }}</dd></div>
          <div><dt>大小</dt><dd>{{ props.selectedAsset.size }}</dd></div>
          <div><dt>校验和</dt><dd><code>{{ props.selectedAsset.checksum ?? '未登记' }}</code></dd></div>
          <div><dt>来源</dt><dd>{{ props.selectedAsset.source }}</dd></div>
          <div><dt>保留策略</dt><dd>{{ props.selectedAsset.retention }}</dd></div>
        </dl>
        <p class="eyebrow">被这些活动引用</p>
        <div class="chip-list"><span v-for="activity in props.selectedAsset.referencedBy" :key="activity">{{ activity }}</span></div>
        <AssetPreview
          v-if="props.runtimeConnected && props.selectedAsset.previewKind && props.selectedAsset.previewUrl"
          :kind="props.selectedAsset.previewKind"
          :label="props.selectedAsset.name"
          :src="props.selectedAsset.previewUrl"
        />
        <p v-else class="asset-preview-empty">连接本地运行时后，这里会显示已登记文件的预览。</p>
        <button type="button" disabled>编辑素材（等待应用服务）</button>
      </article>
    </div>
    <div class="activity-artifact-panel">
      <div class="section-heading"><div><p class="eyebrow">活动产物</p><h3>本次活动生成的文件</h3></div><span>需要用户明确保存才会进入项目素材库</span></div>
      <p v-if="props.assetPromotionError" class="form-error" aria-live="polite">{{ props.assetPromotionError }}</p>
      <div v-if="props.snapshot.activityArtifacts.length > 0" class="artifact-list">
        <article v-for="artifact in props.snapshot.activityArtifacts" :key="artifact.artifactId" class="artifact-list-item">
          <button type="button" @click="emit('select-artifact', artifact.activityId)">
            <strong>{{ artifact.name }}</strong>
            <span>{{ artifact.kind }} · {{ artifact.size }} · {{ artifact.status }} · 校验和 {{ artifact.checksum ? artifact.checksum.slice(0, 12) + '…' : '未登记' }}</span>
          </button>
          <AssetPreview
            v-if="props.runtimeConnected && artifact.previewKind && artifact.previewUrl"
            :kind="artifact.previewKind"
            :label="artifact.name"
            :src="artifact.previewUrl"
          />
          <button
            type="button"
            class="artifact-promote-button"
            :disabled="!props.runtimeConnected || props.projectAssetKindForArtifact(artifact) === null || props.isArtifactPromoted(artifact) || props.assetPromotionPending !== null"
            @click="emit('promote-artifact', artifact)"
          >
            {{ props.assetPromotionPending === artifact.artifactId ? '保存中…' : props.isArtifactPromoted(artifact) ? '已保存为项目素材' : props.projectAssetKindForArtifact(artifact) === null ? '该类型不可晋升' : '保存为项目素材' }}
          </button>
        </article>
      </div>
      <div v-else class="empty-state">当前项目还没有登记活动产物。</div>
    </div>
    <div class="retention-note">
      <span>当前保留规则</span>
      <strong>{{ props.snapshot.storage.retention }}</strong>
      <button type="button" class="primary-button" :disabled="!props.runtimeConnected || props.storagePreviewLoading" @click="emit('toggle-cleanup-preview')">
        {{ props.storagePreviewLoading ? '读取中…' : props.storagePreviewOpen ? '收起清理预览' : '查看清理预览' }}
      </button>
    </div>
    <section v-if="props.storagePreviewOpen" class="cleanup-preview-panel" data-testid="cleanup-preview">
      <div class="section-heading">
        <div><p class="eyebrow">只读检查</p><h3>清理预览</h3></div>
        <span v-if="props.storagePreview">生成于 {{ props.storagePreview.generatedAt }}</span>
      </div>
      <p class="section-intro">这里只检查 Content Studio 已登记的项目素材和活动产物，不扫描未知文件，也不会自动删除。</p>
      <div v-if="props.storagePreview && props.storagePreview.totals.reviewFiles > 0" class="cleanup-actions">
        <span>待确认 {{ props.storagePreview.totals.reviewFiles }} 个活动产物</span>
        <button type="button" class="primary-button" :disabled="props.storageCleanupPending" @click="emit('confirm-cleanup')">
          {{ props.storageCleanupPending ? '移入中…' : props.storageCleanupArmed ? '再次点击确认移入回收区' : '确认移入回收区' }}
        </button>
      </div>
      <p v-if="props.storageCleanupError" class="form-error" aria-live="polite">{{ props.storageCleanupError }}</p>
      <p v-if="props.storageCleanupResult && props.storageCleanupResult.recycled.length > 0" class="cleanup-result" aria-live="polite">
        已移入回收区 {{ props.storageCleanupResult.recycled.length }} 个文件，恢复窗口内可以撤回。
      </p>
      <p v-if="props.storagePreviewError" class="form-error" aria-live="polite">{{ props.storagePreviewError }}</p>
      <template v-else-if="props.storagePreview">
        <div class="cleanup-summary-grid">
          <div><span>登记文件</span><strong>{{ props.storagePreview.totals.files }}</strong></div>
          <div><span>占用空间</span><strong>{{ props.formatStorageBytes(props.storagePreview.totals.totalBytes) }}</strong></div>
          <div><span>待确认</span><strong>{{ props.storagePreview.totals.reviewFiles }} 个 · {{ props.formatStorageBytes(props.storagePreview.totals.reviewBytes) }}</strong></div>
          <div><span>长期保留</span><strong>{{ props.storagePreview.totals.protectedFiles }} 个 · {{ props.formatStorageBytes(props.storagePreview.totals.protectedBytes) }}</strong></div>
          <div><span>文件缺失</span><strong>{{ props.storagePreview.totals.missingFiles }}</strong></div>
        </div>
        <div class="cleanup-item-list">
          <div class="cleanup-item cleanup-item-heading"><span>文件</span><span>范围</span><span>状态</span><span>大小</span></div>
          <div v-for="item in props.storagePreview.items" :key="item.scope + '-' + item.id" class="cleanup-item">
            <div><strong>{{ item.name }}</strong><small>{{ item.relativePath }} · v{{ item.version }}</small></div>
            <span>{{ item.scope === 'project-asset' ? '项目素材' : '活动产物' }}</span>
            <span class="cleanup-status" :data-status="item.status">{{ item.status === 'protected' ? '长期保留' : item.status === 'review' ? '待确认' : item.status === 'recycled' ? '已在回收区' : item.status === 'missing' ? '文件缺失' : '路径不安全' }}</span>
            <span>{{ item.sizeBytes === undefined ? '—' : props.formatStorageBytes(item.sizeBytes) }}</span>
          </div>
        </div>
        <div v-if="props.storageRecycleEntries.length > 0" class="recycle-list">
          <div class="section-heading"><div><p class="eyebrow">可恢复文件</p><h3>回收区</h3></div><span>恢复窗口到期处理将在后续存储策略中提供</span></div>
          <div v-for="entry in props.storageRecycleEntries" :key="entry.recycleId" class="recycle-item">
            <div><strong>{{ entry.originalRelativePath }}</strong><small>移入于 {{ entry.recycledAt }} · 可恢复至 {{ entry.expiresAt }} · {{ props.formatStorageBytes(entry.sizeBytes) }}</small></div>
            <button type="button" class="secondary-button" :disabled="props.storageRestorePending !== null" @click="emit('restore-recycle', entry.recycleId)">
              {{ props.storageRestorePending === entry.recycleId ? '恢复中…' : '恢复文件' }}
            </button>
          </div>
        </div>
        <p v-if="props.storageRestoreError" class="form-error" aria-live="polite">{{ props.storageRestoreError }}</p>
      </template>
      <p v-else class="empty-state">正在读取已登记文件…</p>
    </section>
  </section>
</template>
