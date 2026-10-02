<template>
  <section class="page" data-module="trench">
    <header class="page-head">
      <div>
        <h2>探方登记管理</h2>
        <p class="page-desc">维护探方台账；本探方编录出结论后，待复核数量回写到这里，并生成一条待处理记录。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出探方清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>台账操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>{{ row.探方编号 ?? '—' }}</td>
          <td>{{ row.所属发掘区 ?? '—' }}</td>
          <td>{{ row.布方面积 ?? '—' }}</td>
          <td>{{ row.起始层位 ?? '—' }}</td>
          <td>{{ row.现场负责人 ?? '—' }}</td>
          <td>{{ row.开工日期 ?? '—' }}</td>
          <td>{{ row.最大深度 ?? '—' }}</td>
          <td>
            <span :class="{ 'warn-text': Number(row.待复核数量 ?? 0) > 0 }">{{ row.待复核数量 ?? 0 }}</span>
          </td>
          <td>{{ row.探方状态 ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              class="link"
              type="button"
              :disabled="String(row.现场负责人) !== store.operator"
              :title="String(row.现场负责人) !== store.operator ? `只有探方现场负责人 ${row.现场负责人} 能出结论` : ''"
              @click="onConclude(row)"
            >
              编录出结论
            </button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无探方数据</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">编录结论待处理记录</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>编号</th><th>来源</th><th>探方编号</th><th>现场负责人</th><th>待复核数量</th><th>发生时间</th><th>状态</th><th>说明</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in ledger" :key="String(item.id)">
          <td>{{ item.id }}</td>
          <td>{{ item.来源 }}</td>
          <td>{{ item.探方编号 }}</td>
          <td>{{ item.现场负责人 }}</td>
          <td><span :class="{ 'warn-text': Number(item.待复核数量) > 0 }">{{ item.待复核数量 }}</span></td>
          <td>{{ item.发生时间 }}</td>
          <td>
            <span :class="['status-tag', String(item.status) === '待处理' ? 'tag-warn' : 'tag-muted']">{{ item.status }}</span>
            <span v-if="String(item.status) === '已办结'" class="muted-text">（{{ item.办结人 }} {{ item.办结时间 }}）</span>
          </td>
          <td>{{ item.说明 }}</td>
          <td>
            <button
              v-if="String(item.status) === '待处理'"
              class="link"
              type="button"
              :disabled="!store.isReviewer"
              :title="store.isReviewer ? '' : '只有资料复核员能办结台账记录'"
              @click="onSettle(item)"
            >
              办结
            </button>
            <span v-else class="muted-text">已归档</span>
          </td>
        </tr>
        <tr v-if="!ledger.length">
          <td colspan="9" class="empty-state">暂无编录结论回写的待处理记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条探方记录 · 当前值班：{{ store.operator }}（{{ store.operatorRole }}）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="ok-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { concludeTrench, ledgerRows, settleLedger } from '@/api/trench-service'
import { listRows } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('trench')
const store = useSessionStore()
const columns = ["探方编号", "所属发掘区", "布方面积", "起始层位", "现场负责人", "开工日期", "最大深度", "待复核数量", "探方状态"]
const actions = ["提交布方", "登记停掘", "办理回填"]
const statuses = ["待布方", "发掘中", "已停掘", "已回填"]

const rows = ref<EntryRow[]>([])
const ledger = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["探方编号", "现场负责人", "探方状态"]

const stats = computed(() => {
  const all = listRows('trench')
  const area = all.reduce((sum, row) => {
    const matched = String(row.布方面积 ?? '').match(/\d+(\.\d+)?/)
    return sum + (matched ? Number(matched[0]) : 0)
  }, 0)
  return [
    { label: '发掘中探方', value: all.filter((row) => String(row.status) === '发掘中').length },
    { label: '待复核层位合计', value: all.reduce((sum, row) => sum + Number(row.待复核数量 ?? 0), 0) },
    { label: '累计布方面积', value: area },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function flash(ok: boolean, message: string) {
  errorMessage.value = ok ? '' : message
  successMessage.value = ok ? message : ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function onConclude(row: EntryRow) {
  const result = concludeTrench(Number(row.id), store.operator)
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  reload()
  flash(true, result.message)
}

function onSettle(row: EntryRow) {
  const result = settleLedger(Number(row.id), store.operator, store.isReviewer)
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  reload()
  flash(true, result.message)
}

function runAction(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  reload()
  flash(true, result.message)
}

function reload() {
  errorMessage.value = ''
  successMessage.value = ''
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items
  total.value = payload.total
  ledger.value = [...ledgerRows()].reverse()
}

onMounted(reload)
</script>
