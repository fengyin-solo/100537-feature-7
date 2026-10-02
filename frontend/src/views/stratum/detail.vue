<template>
  <section class="page" v-if="row">
    <header class="page-head">
      <div>
        <h2>层位 {{ code }}</h2>
        <p class="page-desc">
          所属探方 {{ row.所属探方 }} · 归属负责人 {{ owner }} · 原记录人 {{ row.原记录人 }}
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/stratum">返回清单</RouterLink>
      </div>
    </header>

    <div class="rule-banner">
      <strong>权限说明：</strong>
      <template v-if="isMerged">该层位已合并，记录封存只读，任何人不能改动。</template>
      <template v-else-if="editable">
        当前值班人 {{ store.operator }} 是探方 {{ row.所属探方 }} 的现场负责人，可在编录阶段修改本层位；
        送交复核后字段锁定。
      </template>
      <template v-else>
        当前值班人 {{ store.operator }} 对该层位<strong>没有归属权限，本页只读</strong>。
        {{ deny }}
      </template>
      <br />
      <strong>冲突裁定：</strong>层位归属与现场负责人个人意见不一致时，以编录归属记录为准；个人意见不改写记录，
      有异议由资料复核员退回编录或调整归属，归属调整不改变原记录人。
    </div>

    <div class="detail-grid">
      <article v-for="field in fields" :key="field" class="detail-item">
        <span class="detail-label">{{ field }}</span>
        <strong class="detail-value">{{ displayValue(field) }}</strong>
      </article>
      <article class="detail-item">
        <span class="detail-label">当前状态</span>
        <strong :class="['detail-value', 'status-tag', statusClass(String(row.status))]">{{ row.status }}</strong>
      </article>
    </div>

    <div class="detail-actions">
      <RouterLink v-if="editable" class="btn primary" :to="`/stratum`">回清单页编录修改</RouterLink>
      <button
        v-for="action in actions"
        :key="action"
        class="btn"
        :class="{ primary: action === '复核通过' || action === '送交复核' }"
        type="button"
        @click="onAction(action)"
      >
        {{ action }}
      </button>
      <button v-if="store.isReviewer && !isMerged" class="btn" type="button" @click="goTransfer">归属调整（回清单页办理）</button>
      <span v-if="!editable && actions.length === 0 && !isMerged" class="muted-text">该层位当前仅可查看</span>
    </div>

    <h3 class="section-title">历史记录（原记录人与每次流转、调整都留痕）</h3>
    <table class="data-table">
      <thead>
        <tr><th>时间</th><th>动作</th><th>操作人</th><th>说明</th></tr>
      </thead>
      <tbody>
        <tr v-for="(item, index) in history" :key="index">
          <td>{{ item.time }}</td>
          <td>{{ item.action }}</td>
          <td>{{ item.operator }}</td>
          <td>{{ item.detail }}</td>
        </tr>
        <tr v-if="history.length === 0">
          <td colspan="4" class="empty-state">暂无历史记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>层位编号与清单页同源生成：{{ code }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="ok-text">{{ successMessage }}</span>
    </footer>
  </section>

  <section v-else class="page">
    <p class="empty-state">没有找到这个层位，可能已被重置。</p>
    <RouterLink class="btn" to="/stratum">返回清单</RouterLink>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  canEdit,
  denyReason,
  getStratum,
  ownerOf,
  stratumAction,
  stratumCodeOf,
} from '@/api/stratum-service'
import { useSessionStore } from '@/stores/session'
import type { HistoryEntry } from '@/data/types'

const route = useRoute()
const router = useRouter()
const store = useSessionStore()

const fields = ["土质", "土色", "包含物", "堆积厚度", "判定年代", "堆积状态"]

// 详情页通过同一个服务读取，编号同样取自 stratumCodeOf，保证与清单页一致。
const row = computed(() => getStratum(Number(route.params.id)))
const code = computed(() => (row.value ? stratumCodeOf(row.value) : ''))
const owner = computed(() => (row.value ? ownerOf(row.value) : ''))
const editable = computed(() => (row.value ? canEdit(row.value, store.operator) : false))
const deny = computed(() => (row.value ? denyReason(row.value, store.operator) : ''))
const isMerged = computed(() => row.value && String(row.value.status) === '已合并')
const history = computed<HistoryEntry[]>(() => {
  const value = row.value?.历史记录
  return Array.isArray(value) ? (value as HistoryEntry[]) : []
})

const errorMessage = ref('')
const successMessage = ref('')

function displayValue(field: string): string {
  const value = row.value ? String(row.value[field] ?? '') : ''
  return value === '' ? '（待填）' : value
}

function statusClass(status: string): string {
  if (status === '待复核') return 'tag-warn'
  if (status === '已复核') return 'tag-ok'
  if (status === '已合并') return 'tag-muted'
  return 'tag-info'
}

const actions = computed(() => {
  if (!row.value || isMerged.value) return []
  const status = String(row.value.status)
  const list: string[] = []
  if (status === '待编录' && editable.value) list.push('提交编录')
  if (status === '编录中' && editable.value) list.push('送交复核')
  if (status === '待复核' && store.isReviewer) list.push('复核通过', '退回编录')
  if (status === '已复核' && store.isReviewer) list.push('退回编录', '合并层位')
  return list
})

function onAction(action: string) {
  if (!row.value) return
  const result = stratumAction(Number(row.value.id), action, store.operator, store.isReviewer)
  errorMessage.value = result.ok ? '' : result.message
  successMessage.value = result.ok ? result.message : ''
}

function goTransfer() {
  router.push('/stratum')
}
</script>
