<template>
  <section class="page" data-module="stratum">
    <header class="page-head">
      <div>
        <h2>地层堆积管理</h2>
        <p class="page-desc">层位归属到探方，由本探方现场负责人编录；无归属权限的层位只读。编号＝探方号-流水号。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记层位</button>
        <button class="btn" type="button" @click="exportRows">导出层位清单</button>
      </div>
    </header>

    <div class="rule-banner">
      <strong>归属与裁定规则：</strong>
      层位归属随探方台账的现场负责人，只有本探方负责人能改自己管辖的层位，越权改动一律拦截并说明原因；
      已送交复核或已复核的层位锁定只读，须由资料复核员「退回编录」。
      <strong>层位归属与现场负责人个人意见冲突时，一律以编录归属记录为准</strong>，个人意见不直接改写记录，
      有异议请资料复核员退回或调整归属。归属调整后原记录人仍保留在记录里。
    </div>

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
          <th>归属权限</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>
            <RouterLink class="link" :to="`/stratum/${row.id}`">{{ codeOf(row) }}</RouterLink>
          </td>
          <td>{{ row.所属探方 ?? '—' }}</td>
          <td>{{ row.归属负责人 ?? '—' }}<span class="muted-text">（原记录人：{{ row.原记录人 ?? '—' }}）</span></td>
          <td>{{ row.土质 || '—' }}</td>
          <td>{{ row.土色 || '—' }}</td>
          <td>{{ row.包含物 || '—' }}</td>
          <td>{{ row.堆积厚度 || '—' }}</td>
          <td>{{ row.判定年代 || '—' }}</td>
          <td>{{ row.堆积状态 || '—' }}</td>
          <td>
            <span :class="['status-tag', statusClass(String(row.status))]">{{ row.status }}</span>
          </td>
          <td>
            <span v-if="isMerged(row)" class="lock-text">封存只读</span>
            <span v-else-if="canEditRow(row)" class="ok-text">可编录</span>
            <span v-else class="lock-text">只读</span>
          </td>
          <td class="row-actions">
            <button
              v-if="canEditRow(row)"
              class="link"
              type="button"
              @click="openEdit(row)"
            >
              编录修改
            </button>
            <button
              v-if="store.isReviewer"
              class="link"
              type="button"
              @click="openTransfer(row)"
            >
              归属调整
            </button>
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!canEditRow(row) && !store.isReviewer && !isMerged(row)" class="muted-text">仅可查看</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无层位数据，可先在自己管辖的探方下登记层位</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条层位记录 · 当前值班：{{ store.operator }}（{{ store.operatorRole }}）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="ok-text">{{ successMessage }}</span>
    </footer>

    <!-- 登记层位 -->
    <div v-if="createVisible" class="modal-mask" @click.self="createVisible = false">
      <div class="modal">
        <h3>登记层位</h3>
        <p class="modal-tip">层位编号在保存时按「探方号-流水号」自动生成，重复编号不允许保存。</p>
        <label class="form-item">
          <span>所属探方</span>
          <select v-model="createForm.所属探方">
            <option value="" disabled>请选择探方</option>
            <option v-for="trench in creatableTrenches" :key="String(trench.探方编号)" :value="String(trench.探方编号)">
              {{ trench.探方编号 }}（负责人 {{ trench.现场负责人 }}）
            </option>
          </select>
        </label>
        <p v-if="creatableTrenches.length === 0" class="error-text">你名下没有管辖的探方，不能登记层位；请到探方登记页确认现场负责人。</p>
        <label v-for="field in observationFields" :key="field" class="form-item">
          <span>{{ field }}</span>
          <input v-model="createForm[field]" :placeholder="`请填写${field}`" />
        </label>
        <label class="form-item">
          <span>判定年代</span>
          <input v-model="createForm.判定年代" placeholder="可留待复核后补充" />
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="createVisible = false">取消</button>
          <button class="btn primary" type="button" :disabled="!createForm.所属探方" @click="submitCreate">保存</button>
        </div>
      </div>
    </div>

    <!-- 编录修改 -->
    <div v-if="editTarget" class="modal-mask" @click.self="editTarget = null">
      <div class="modal">
        <h3>编录修改 · {{ codeOf(editTarget) }}</h3>
        <p class="modal-tip">归属探方 {{ editTarget.所属探方 }}，原记录人 {{ editTarget.原记录人 }}；改动会写入历史记录。</p>
        <label v-for="field in editableFields" :key="field" class="form-item">
          <span>{{ field }}</span>
          <input v-model="editForm[field]" :placeholder="`请填写${field}`" />
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="editTarget = null">取消</button>
          <button class="btn primary" type="button" @click="submitEdit">保存改动</button>
        </div>
      </div>
    </div>

    <!-- 归属调整（仅资料复核员） -->
    <div v-if="transferTarget" class="modal-mask" @click.self="transferTarget = null">
      <div class="modal">
        <h3>调整层位归属 · {{ codeOf(transferTarget) }}</h3>
        <p class="modal-tip">
          调整后编号按新探方流水号重编（{{ transferTarget.层位编号 }} → 新编号），归属负责人换成新探方现场负责人；
          原记录人 <strong>{{ transferTarget.原记录人 }}</strong> 保留不变，调整过程写入历史记录。
        </p>
        <label class="form-item">
          <span>转入探方</span>
          <select v-model="transferTrench">
            <option value="" disabled>请选择转入探方</option>
            <option
              v-for="trench in otherTrenches"
              :key="String(trench.探方编号)"
              :value="String(trench.探方编号)"
            >
              {{ trench.探方编号 }}（负责人 {{ trench.现场负责人 }}）
            </option>
          </select>
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="transferTarget = null">取消</button>
          <button class="btn primary" type="button" :disabled="!transferTrench" @click="submitTransfer">确认调整</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
} from '@/api/local-service'
import { stratumAction, stratumCodeOf, stratumStats } from '@/api/stratum-service'
import {
  canEdit,
  createStratum,
  editStratum,
  listStrata,
  ownerOf,
  reassignStratum,
} from '@/api/stratum-service'
import type { StratumInput } from '@/api/stratum-service'
import { listRows } from '@/data/local-store'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()

const columns = ["层位编号", "所属探方", "归属负责人", "土质", "土色", "包含物", "堆积厚度", "判定年代", "堆积状态"]
const statuses = ["待编录", "编录中", "待复核", "已复核", "已合并"]
const observationFields = ["土质", "土色", "包含物", "堆积厚度"] as const
const editableFields = [...observationFields, "判定年代", "堆积状态"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const stats = ref(stratumStats())
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["层位编号", "所属探方", "土质"]

const codeOf = stratumCodeOf
const isMerged = (row: EntryRow) => String(row.status) === '已合并'
const canEditRow = (row: EntryRow) => canEdit(row, store.operator)

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const trenches = computed(() => listRows('trench'))
const creatableTrenches = computed(() =>
  trenches.value.filter((row) => String(row.现场负责人) === store.operator),
)
const otherTrenches = computed(() =>
  transferTarget.value
    ? trenches.value.filter((row) => String(row.探方编号) !== String(transferTarget.value!.所属探方))
    : [],
)

function statusClass(status: string): string {
  if (status === '待复核') return 'tag-warn'
  if (status === '已复核') return 'tag-ok'
  if (status === '已合并') return 'tag-muted'
  return 'tag-info'
}

// 每个状态下页面实际暴露的动作：归属动作限本探方负责人，复核动作限复核员。
function availableActions(row: EntryRow): string[] {
  const status = String(row.status)
  const owner = ownerOf(row)
  const isOwner = owner === store.operator
  const isReviewer = store.isReviewer
  const actions: string[] = []
  if (status === '待编录' && isOwner) actions.push('提交编录')
  if (status === '编录中' && isOwner) actions.push('送交复核')
  if (status === '待复核' && isReviewer) actions.push('复核通过', '退回编录')
  if (status === '已复核' && isReviewer) actions.push('退回编录', '合并层位')
  return actions
}

function flash(ok: boolean, message: string) {
  errorMessage.value = ok ? '' : message
  successMessage.value = ok ? message : ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries('stratum')
}

// ---- 登记 ----
const createVisible = ref(false)
const createForm = reactive<StratumInput>({
  所属探方: '',
  土质: '',
  土色: '',
  包含物: '',
  堆积厚度: '',
  判定年代: '',
})

function openCreate() {
  Object.assign(createForm, { 所属探方: '', 土质: '', 土色: '', 包含物: '', 堆积厚度: '', 判定年代: '' })
  createVisible.value = true
}

function submitCreate() {
  const result = createStratum({ ...createForm }, store.operator)
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  createVisible.value = false
  reload()
  flash(true, result.message)
}

// ---- 编录修改 ----
const editTarget = ref<EntryRow | null>(null)
const editForm = reactive<Record<string, string>>({})

function openEdit(row: EntryRow) {
  editTarget.value = row
  for (const field of editableFields) {
    editForm[field] = String(row[field] ?? '')
  }
}

function submitEdit() {
  if (!editTarget.value) return
  const result = editStratum(Number(editTarget.value.id), { ...editForm }, store.operator)
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  editTarget.value = null
  reload()
  flash(true, result.message)
}

// ---- 归属调整 ----
const transferTarget = ref<EntryRow | null>(null)
const transferTrench = ref('')

function openTransfer(row: EntryRow) {
  transferTarget.value = row
  transferTrench.value = ''
}

function submitTransfer() {
  if (!transferTarget.value) return
  const result = reassignStratum(Number(transferTarget.value.id), transferTrench.value, store.operator, store.isReviewer)
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  transferTarget.value = null
  reload()
  flash(true, result.message)
}

function runAction(action: string, row: EntryRow) {
  const result = stratumAction(Number(row.id), action, store.operator, store.isReviewer)
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
  const payload = listStrata(filters.value)
  rows.value = payload.items
  total.value = payload.total
  stats.value = stratumStats()
}

onMounted(reload)
</script>
