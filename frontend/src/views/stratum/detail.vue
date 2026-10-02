<template>
  <section class="page" data-module="stratum-detail">
    <header class="page-head">
      <div>
        <h2>层位详情{{ row ? `：${row['层位编号']}` : '' }}</h2>
        <p class="page-desc">本页层位编号与清单页同源于本地数据层，两处读到的一致；无归属权限时整页只读。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/stratum">返回地层堆积清单</RouterLink>
      </div>
    </header>

    <p class="notice-bar">归属裁定规则：{{ conflictRule }}</p>

    <template v-if="row">
      <div class="detail-grid">
        <div class="detail-item">
          <span class="detail-label">层位编号</span>
          <strong class="detail-value">{{ row['层位编号'] }}</strong>
        </div>
        <div class="detail-item">
          <span class="detail-label">所属探方</span>
          <span class="detail-value">{{ row['所属探方'] }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">当前状态</span>
          <span class="detail-value">{{ row.status }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">归属人</span>
          <span class="detail-value">{{ row['归属人'] }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">记录人（归属调整后仍保留原记录人）</span>
          <span class="detail-value">{{ row['记录人'] }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">探方现场负责人</span>
          <span class="detail-value">{{ leader || '未登记' }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">当前值班「{{ store.operator }}」的权限</span>
          <span class="tag" :class="permission.editable ? 'editable' : 'readonly'">
            {{ permission.editable ? '可改' : '只读' }}
          </span>
        </div>
      </div>
      <p v-if="!permission.editable" class="error-text">
        只读原因：{{ permission.reason }}，只能查看不能改动。
      </p>

      <div class="panel">
        <h3>编录内容{{ contentEditable ? '' : '（只读）' }}</h3>
        <p v-if="permission.editable && !contentEditable" class="page-desc">
          当前状态「{{ row.status }}」，编录内容已锁定；已复核的层位须先退回编录，字段清空后重填。
        </p>
        <div class="form-grid">
          <label v-for="field in contentFields" :key="field" class="form-item">
            <span>{{ field }}</span>
            <input
              v-if="contentEditable"
              v-model="form[field]"
              :placeholder="row[field] ? '' : '待补录'"
            />
            <span v-else class="detail-value">{{ row[field] || '—' }}</span>
          </label>
        </div>
        <div v-if="contentEditable" class="panel-foot">
          <button class="btn primary" type="button" @click="saveContent">保存编录</button>
        </div>
      </div>

      <div class="panel">
        <h3>状态流转</h3>
        <div class="row-actions">
          <button
            v-for="action in actions"
            :key="action"
            class="btn"
            type="button"
            @click="runAction(action)"
          >
            {{ action }}
          </button>
          <span v-if="!actions.length" class="muted-text">当前状态没有可执行的流转动作</span>
        </div>
      </div>

      <div class="panel">
        <h3>归属调整</h3>
        <template v-if="canReassign">
          <div class="row-actions">
            <select v-model="newOwner">
              <option value="" disabled>选择新归属人</option>
              <option v-for="name in ownerOptions" :key="name" :value="name">{{ name }}</option>
            </select>
            <button class="btn" type="button" @click="reassign">调整归属</button>
          </div>
          <p class="page-desc">调整只改归属人，记录人不动，编录历史里仍保留原记录人。</p>
        </template>
        <p v-else class="page-desc">
          只有所属探方 {{ row['所属探方'] }} 的现场负责人「{{ leader || '未登记' }}」能调整归属，当前值班「{{ store.operator }}」无权。
        </p>
      </div>

      <div class="panel">
        <h3>编录历史</h3>
        <table class="data-table">
          <thead>
            <tr><th>时间</th><th>记录人</th><th>事件</th><th>详情</th></tr>
          </thead>
          <tbody>
            <tr v-for="(entry, index) in history" :key="index">
              <td>{{ entry.时间 }}</td>
              <td>{{ entry.记录人 }}</td>
              <td>{{ entry.事件 }}</td>
              <td>{{ entry.详情 || '—' }}</td>
            </tr>
            <tr v-if="!history.length">
              <td colspan="4" class="empty-state">暂无编录历史</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="panel">
        <h3>归属历史</h3>
        <table class="data-table">
          <thead>
            <tr><th>时间</th><th>原归属人</th><th>新归属人</th><th>操作人</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr v-for="(entry, index) in ownerHistory" :key="index">
              <td>{{ entry.时间 }}</td>
              <td>{{ entry.原归属人 }}</td>
              <td>{{ entry.新归属人 }}</td>
              <td>{{ entry.操作人 }}</td>
              <td>{{ entry.说明 || '—' }}</td>
            </tr>
            <tr v-if="!ownerHistory.length">
              <td colspan="5" class="empty-state">暂无归属调整记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <p v-else class="empty-state">没有找到该层位，可能已被重置，请返回清单重新进入。</p>

    <footer class="page-foot">
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="success-text">{{ noticeMessage }}</span>
      <span v-else>层位编号、归属与历史均读取自本地数据层</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  STRATUM_CONFLICT_RULE,
  STRATUM_CONTENT_FIELDS,
  STRATUM_EDITABLE_STATUSES,
  getStratum,
  reassignStratumOwner,
  runStratumAction,
  stratumActionsFor,
  stratumHistoryEntries,
  stratumOwnerEntries,
  stratumPermission,
  trenchLeader,
  updateStratumContent,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const store = useSessionStore()
const id = Number(route.params.id)
const conflictRule = STRATUM_CONFLICT_RULE
const contentFields = STRATUM_CONTENT_FIELDS

const row = ref<EntryRow | null>(null)
const form = reactive<Record<string, string>>({})
const newOwner = ref('')
const errorMessage = ref('')
const noticeMessage = ref('')

const permission = computed(() =>
  row.value ? stratumPermission(row.value, store.operator) : { editable: false, reason: '' },
)
const contentEditable = computed(
  () =>
    permission.value.editable &&
    row.value !== null &&
    STRATUM_EDITABLE_STATUSES.includes(String(row.value.status)),
)
const leader = computed(() => (row.value ? trenchLeader(String(row.value['所属探方'])) : ''))
const canReassign = computed(() => leader.value !== '' && leader.value === store.operator)
const actions = computed(() => (row.value ? stratumActionsFor(String(row.value.status)) : []))
const history = computed(() => (row.value ? stratumHistoryEntries(row.value) : []))
const ownerHistory = computed(() => (row.value ? stratumOwnerEntries(row.value) : []))
const ownerOptions = computed(() =>
  store.roster.filter((name) => name !== String(row.value?.['归属人'] ?? '')),
)

function show(result: { ok: boolean; message: string }): boolean {
  if (result.ok) {
    noticeMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    noticeMessage.value = ''
  }
  return result.ok
}

function reload() {
  const found = getStratum(id)
  row.value = found ?? null
  for (const field of contentFields) {
    form[field] = found ? String(found[field] ?? '') : ''
  }
}

function saveContent() {
  if (show(updateStratumContent(id, { ...form }, store.operator))) {
    reload()
  }
}

function runAction(action: string) {
  if (show(runStratumAction(id, action, store.operator))) {
    reload()
  }
}

function reassign() {
  if (show(reassignStratumOwner(id, newOwner.value, store.operator))) {
    newOwner.value = ''
    reload()
  }
}

onMounted(reload)
</script>
