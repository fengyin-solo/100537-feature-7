<template>
  <section class="page" data-module="stratum">
    <header class="page-head">
      <div>
        <h2>地层堆积管理</h2>
        <p class="page-desc">维护地层堆积，围绕层位编号、所属探方、土质、土色做登记、筛选与状态流转；层位按归属管控，无归属权限的一律只读。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记地层堆积</button>
        <button class="btn" type="button" @click="exportRows">导出地层堆积清单</button>
      </div>
    </header>

    <p class="notice-bar">归属裁定规则：{{ conflictRule }}</p>

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

    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>归属权限</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">
              <RouterLink v-if="column === '层位编号'" :to="`/stratum/${row.id}`">
                {{ row[column] ?? '—' }}
              </RouterLink>
              <template v-else>{{ row[column] || '—' }}</template>
            </td>
            <td>{{ row.status }}</td>
            <td>
              <span class="tag" :class="permissionOf(row).editable ? 'editable' : 'readonly'">
                {{ permissionOf(row).editable ? '可改' : '只读' }}
              </span>
            </td>
            <td class="row-actions">
              <button
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <span v-if="!actionsFor(row).length" class="muted-text">无</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 3" class="empty-state">暂无地层堆积数据，可先登记地层堆积</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条地层堆积记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="success-text">{{ noticeMessage }}</span>
    </footer>

    <div v-if="createOpen" class="modal-mask" @click.self="closeCreate">
      <div class="modal-panel">
        <div class="modal-head">
          <h3>登记地层堆积</h3>
          <button class="link" type="button" @click="closeCreate">关闭</button>
        </div>
        <div class="form-grid">
          <label class="form-item">
            <span>所属探方</span>
            <select v-model="createForm.所属探方">
              <option value="" disabled>选择探方</option>
              <option v-for="item in trenchOptions" :key="item.code" :value="item.code">
                {{ item.code }}（现场负责人：{{ item.leader || '未登记' }}）
              </option>
            </select>
          </label>
          <label class="form-item">
            <span>流水号（层位编号 = 探方号-流水号）</span>
            <input v-model="createForm.流水号" placeholder="如 004" />
          </label>
          <label v-for="field in contentFields" :key="field" class="form-item">
            <span>{{ field }}</span>
            <input v-model="createForm[field]" :placeholder="`填写${field}，可留空待补`" />
          </label>
        </div>
        <p class="preview-line">
          层位编号预览：<strong>{{ createPreview }}</strong>，登记人即归属人（{{ store.operator }}）
        </p>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-foot">
          <button class="btn ghost" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">保存登记</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  STRATUM_CONFLICT_RULE,
  STRATUM_CONTENT_FIELDS,
  composeStratumCode,
  createStratum,
  downloadEntries,
  listEntries,
  moduleMeta,
  nextStratumSerial,
  runStratumAction,
  stratumActionsFor,
  stratumPermission,
} from '@/api/local-service'
import type { CreateStratumInput } from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('stratum')
const store = useSessionStore()
const columns = ["层位编号", "所属探方", "土质", "土色", "包含物", "堆积厚度", "判定年代", "堆积状态", "归属人"]
const statuses = meta.statuses
const contentFields = STRATUM_CONTENT_FIELDS
const conflictRule = STRATUM_CONFLICT_RULE

const rows = ref<EntryRow[]>([])
const statsSource = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const createOpen = ref(false)
const createError = ref('')
const createForm = reactive<Record<string, string>>({
  所属探方: '',
  流水号: '',
  土质: '',
  土色: '',
  包含物: '',
  堆积厚度: '',
  判定年代: '',
  堆积状态: '',
})
const trenchOptions = ref<{ code: string; leader: string }[]>([])

const stats = computed(() => [
  { label: '待编录层位', value: countStatus('待编录') },
  { label: '编录中层位', value: countStatus('编录中') },
  { label: '待复核层位', value: countStatus('待复核') },
  { label: '已复核层位', value: countStatus('已复核') },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: statsSource.value.filter((row) => String(row.status) === status).length,
  })),
)
const createPreview = computed(() =>
  createForm.所属探方 && createForm.流水号.trim()
    ? composeStratumCode(createForm.所属探方, createForm.流水号)
    : '—',
)

watch(
  () => createForm.所属探方,
  (code) => {
    if (code) {
      createForm.流水号 = nextStratumSerial(code)
    }
  },
)

function countStatus(status: string): number {
  return statsSource.value.filter((row) => String(row.status) === status).length
}

function permissionOf(row: EntryRow) {
  return stratumPermission(row, store.operator)
}

function actionsFor(row: EntryRow): string[] {
  return stratumActionsFor(String(row.status))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  createError.value = ''
  trenchOptions.value = listEntries('trench').items.map((row) => ({
    code: String(row['探方编号']),
    leader: String(row['现场负责人'] ?? ''),
  }))
  createForm.所属探方 = trenchOptions.value[0]?.code ?? ''
  createForm.流水号 = createForm.所属探方 ? nextStratumSerial(createForm.所属探方) : ''
  for (const field of contentFields) {
    createForm[field] = ''
  }
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
}

function submitCreate() {
  const result = createStratum({ ...createForm } as CreateStratumInput, store.operator)
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  noticeMessage.value = result.message
  errorMessage.value = ''
  reload()
}

function runAction(action: string, row: EntryRow) {
  const result = runStratumAction(Number(row.id), action, store.operator)
  if (result.ok) {
    noticeMessage.value = result.message
    errorMessage.value = ''
    reload()
  } else {
    errorMessage.value = result.message
    noticeMessage.value = ''
  }
}

function reload() {
  errorMessage.value = ''
  try {
    statsSource.value = listEntries(meta.key).items
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '地层堆积列表读取失败'
  }
}

onMounted(reload)
</script>
