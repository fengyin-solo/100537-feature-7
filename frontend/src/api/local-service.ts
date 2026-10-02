import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// —— 地层堆积：归属管控、编号拼合、退回重填、台账回写 ——
// 地层编录在野外一条条补上来，谁都能改就追不回来，所以这一模块的读写不走通用 runAction，
// 全部经过下面这组带归属校验的函数。

const STRATUM_KEY = 'stratum'
const TRENCH_KEY = 'trench'

/** 编录内容字段：退回编录时清空的就是这一组，保存时也只允许改这一组。 */
export const STRATUM_CONTENT_FIELDS = ['土质', '土色', '包含物', '堆积厚度', '判定年代', '堆积状态']
/** 编录出结论（送交复核）前必须填齐的字段。 */
export const STRATUM_REQUIRED_BEFORE_REVIEW = ['土质', '土色', '堆积厚度', '判定年代']
/** 只有这两种状态下编录内容可以改，其余状态内容锁定。 */
export const STRATUM_EDITABLE_STATUSES = ['待编录', '编录中']
const STRATUM_DONE_STATUSES = ['已复核', '已合并']

/** 页面上要公示的裁定规则：归属记录与现场负责人意见冲突时以谁为准。 */
export const STRATUM_CONFLICT_RULE =
  '层位归属与现场负责人意见冲突时，以本页登记的编录归属为准：归属人本人或所属探方的现场负责人可改，其余值班人只读；负责人对归属有异议须先办理「调整归属」，调整生效前仍按原归属执行。'

/** 每个动作允许的起始状态，越状态的流转一律拦下。 */
const STRATUM_ACTION_SOURCES: Record<string, string[]> = {
  提交编录: ['待编录'],
  送交复核: ['编录中'],
  复核通过: ['待复核'],
  退回编录: ['已复核'],
  合并层位: ['待编录', '编录中', '待复核'],
}

export type StratumHistoryEntry = { 时间: string; 记录人: string; 事件: string; 详情?: string }
export type StratumOwnerEntry = { 时间: string; 原归属人: string; 新归属人: string; 操作人: string; 说明?: string }
export type StratumPermission = { editable: boolean; reason: string }

function nowLabel(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function parseHistory(raw: unknown): Record<string, string>[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'))
    return Array.isArray(parsed) ? (parsed as Record<string, string>[]) : []
  } catch {
    return []
  }
}

/** 编录历史：每条都带当时的记录人，归属调整后原记录人仍保留在历史里。 */
export function stratumHistoryEntries(row: EntryRow): StratumHistoryEntry[] {
  return parseHistory(row['编录历史']) as StratumHistoryEntry[]
}

/** 归属历史：每次归属调整留一条，谁调的、从谁到谁都查得到。 */
export function stratumOwnerEntries(row: EntryRow): StratumOwnerEntry[] {
  return parseHistory(row['归属历史']) as StratumOwnerEntry[]
}

function appendHistory(row: EntryRow, field: '编录历史' | '归属历史', entry: Record<string, string>): EntryRow {
  return { ...row, [field]: JSON.stringify([...parseHistory(row[field]), entry]) }
}

/** 层位编号 = 探方号 + 流水号，清单页、详情页、登记预览都用这一个拼法。 */
export function composeStratumCode(trenchCode: string, serial: string): string {
  return `${trenchCode.trim()}-${serial.trim().padStart(3, '0')}`
}

/** 该探方下一条可用的流水号（取现有最大流水号 +1）。 */
export function nextStratumSerial(trenchCode: string): string {
  const prefix = `${trenchCode}-`
  let max = 0
  for (const row of listRows(STRATUM_KEY)) {
    const code = String(row['层位编号'] ?? '')
    if (!code.startsWith(prefix)) continue
    const serial = Number(code.slice(prefix.length))
    if (Number.isFinite(serial) && serial > max) max = serial
  }
  return String(max + 1).padStart(3, '0')
}

export function getStratum(id: number): EntryRow | undefined {
  return listRows(STRATUM_KEY).find((row) => Number(row.id) === id)
}

export function trenchLeader(trenchCode: string): string {
  const trench = listRows(TRENCH_KEY).find((item) => String(item['探方编号']) === trenchCode)
  return trench ? String(trench['现场负责人'] ?? '') : ''
}

/**
 * 归属判定：归属人本人可改；所属探方的现场负责人可改自己管辖的层位；
 * 其余人只读，reason 里写明为什么改不了，页面直接展示。
 */
export function stratumPermission(row: EntryRow, operator: string): StratumPermission {
  const owner = String(row['归属人'] ?? '')
  if (owner !== '' && owner === operator) {
    return { editable: true, reason: '' }
  }
  const leader = trenchLeader(String(row['所属探方'] ?? ''))
  if (leader !== '' && leader === operator) {
    return { editable: true, reason: '' }
  }
  return {
    editable: false,
    reason: `层位归属「${owner || '未登记'}」，所属探方 ${String(row['所属探方'] ?? '未知')} 的现场负责人为「${leader || '未登记'}」；当前值班「${operator}」既非归属人也非该探方负责人`,
  }
}

/** 写操作统一过这道闸：没有归属权限的层位只读，改动拦下并写明为什么被拒。 */
function denyIfReadonly(row: EntryRow, operator: string): ActionResult | null {
  const permission = stratumPermission(row, operator)
  if (permission.editable) return null
  return { ok: false, message: `改动被拦下：层位 ${String(row['层位编号'])} ${permission.reason}，按归属裁定规则只读不能改` }
}

/** 当前状态下可执行的流转动作（页面按它渲染按钮，服务里仍会做同样的校验）。 */
export function stratumActionsFor(status: string): string[] {
  const meta = moduleMeta(STRATUM_KEY)
  return meta.actions.filter((action) => (STRATUM_ACTION_SOURCES[action] ?? []).includes(status))
}

/** 待复核数量回写探方台账：数量变了，探方行的待处理标记跟着变。 */
function syncTrenchLedger(trenchCode: string): void {
  const trenches = listRows(TRENCH_KEY)
  const index = trenches.findIndex((item) => String(item['探方编号']) === trenchCode)
  if (index < 0) return
  const count = listRows(STRATUM_KEY).filter(
    (row) => String(row['所属探方']) === trenchCode && String(row.status) === '待复核',
  ).length
  const next = [...trenches]
  next[index] = { ...next[index], 待复核层位: count, pending: count > 0 }
  saveRows(TRENCH_KEY, next)
}

export type CreateStratumInput = {
  所属探方: string
  流水号: string
  土质: string
  土色: string
  包含物: string
  堆积厚度: string
  判定年代: string
  堆积状态: string
}

/** 登记层位：编号用探方号加流水号拼出来，重复的编号不允许保存；登记人即归属人、记录人。 */
export function createStratum(input: CreateStratumInput, operator: string): ActionResult {
  const trenchCode = input.所属探方.trim()
  const trench = listRows(TRENCH_KEY).find((item) => String(item['探方编号']) === trenchCode)
  if (!trench) {
    return { ok: false, message: `探方 ${trenchCode || '（未选）'} 没有登记，层位编号要用已登记的探方号来拼` }
  }
  const serial = input.流水号.trim()
  if (!/^\d{1,3}$/.test(serial)) {
    return { ok: false, message: '流水号只能是 1-3 位数字，层位编号按「探方号-流水号」拼出' }
  }
  const code = composeStratumCode(trenchCode, serial)
  const rows = listRows(STRATUM_KEY)
  if (rows.some((row) => String(row['层位编号']) === code)) {
    return { ok: false, message: `层位编号 ${code} 已存在，重复的编号不允许保存` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  let row: EntryRow = {
    id,
    status: '待编录',
    pending: true,
    abnormal: false,
    层位编号: code,
    所属探方: trenchCode,
    土质: input.土质.trim(),
    土色: input.土色.trim(),
    包含物: input.包含物.trim(),
    堆积厚度: input.堆积厚度.trim(),
    判定年代: input.判定年代.trim(),
    堆积状态: input.堆积状态.trim(),
    归属人: operator,
    记录人: operator,
    归属历史: '[]',
    编录历史: '[]',
  }
  row = appendHistory(row, '编录历史', {
    时间: nowLabel(),
    记录人: operator,
    事件: `登记层位，编号按探方号加流水号拼为 ${code}`,
  })
  saveRows(STRATUM_KEY, [...rows, row])
  syncTrenchLedger(trenchCode)
  return { ok: true, message: `地层堆积已登记，层位编号 ${code}，归属「${operator}」` }
}

/** 保存编录内容：只认归属权限内、且仍在编录阶段的层位，只放行编录字段。 */
export function updateStratumContent(id: number, patch: Record<string, string>, operator: string): ActionResult {
  const rows = listRows(STRATUM_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的地层堆积` }
  }
  const row = rows[index]
  const denied = denyIfReadonly(row, operator)
  if (denied) return denied
  const status = String(row.status)
  if (!STRATUM_EDITABLE_STATUSES.includes(status)) {
    return { ok: false, message: `层位 ${String(row['层位编号'])} 当前「${status}」，编录内容已锁定；要改先退回编录` }
  }
  const changed = STRATUM_CONTENT_FIELDS.filter(
    (field) => patch[field] !== undefined && patch[field].trim() !== String(row[field] ?? ''),
  )
  if (changed.length === 0) {
    return { ok: false, message: '编录内容没有变化，不用保存' }
  }
  let next: EntryRow = { ...row }
  for (const field of changed) {
    next = { ...next, [field]: patch[field].trim() }
  }
  next = appendHistory(next, '编录历史', {
    时间: nowLabel(),
    记录人: operator,
    事件: `修改编录（${changed.join('、')}）`,
  })
  const nextRows = [...rows]
  nextRows[index] = next
  saveRows(STRATUM_KEY, nextRows)
  return { ok: true, message: `层位 ${String(row['层位编号'])} 编录已保存（${changed.join('、')}）` }
}

/**
 * 地层状态流转：先查归属权限，再查起始状态。
 * 退回编录会把土质、土色等编录字段清空待重填，旧值留在编录历史里；
 * 送交复核后待复核数量回写探方台账。
 */
export function runStratumAction(id: number, action: string, operator: string): ActionResult {
  const meta = moduleMeta(STRATUM_KEY)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `地层堆积没有登记「${action}」这个动作` }
  }
  const rows = listRows(STRATUM_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的地层堆积` }
  }
  const row = rows[index]
  const denied = denyIfReadonly(row, operator)
  if (denied) return denied
  const current = String(row.status)
  const sources = STRATUM_ACTION_SOURCES[action] ?? []
  if (!sources.includes(current)) {
    return { ok: false, message: `层位 ${String(row['层位编号'])} 当前「${current}」，不能执行「${action}」（允许的状态：${sources.join('、')}）` }
  }
  if (action === '送交复核') {
    const missing = STRATUM_REQUIRED_BEFORE_REVIEW.filter((field) => String(row[field] ?? '').trim() === '')
    if (missing.length > 0) {
      return { ok: false, message: `层位 ${String(row['层位编号'])} 的${missing.join('、')}还没填，编录出结论后才能送交复核` }
    }
  }
  let next: EntryRow = {
    ...row,
    status: target,
    pending: !STRATUM_DONE_STATUSES.includes(target),
    abnormal: action === '退回编录',
  }
  let event = `${action}，状态转为「${target}」`
  let detail = ''
  if (action === '退回编录') {
    const cleared: Record<string, string> = {}
    for (const field of STRATUM_CONTENT_FIELDS) {
      cleared[field] = String(next[field] ?? '')
      next = { ...next, [field]: '' }
    }
    event = '退回编录，土质、土色等编录字段已清空待重填'
    detail = `清空前旧值：${STRATUM_CONTENT_FIELDS.map((field) => `${field}=${cleared[field] || '空'}`).join('，')}`
  }
  next = appendHistory(next, '编录历史', { 时间: nowLabel(), 记录人: operator, 事件: event, 详情: detail })
  const nextRows = [...rows]
  nextRows[index] = next
  saveRows(STRATUM_KEY, nextRows)
  syncTrenchLedger(String(next['所属探方']))
  const extra = action === '送交复核' ? `，待复核数量已回写探方 ${String(next['所属探方'])} 台账` : ''
  return { ok: true, message: `层位 ${String(row['层位编号'])} 已${action}，当前状态「${target}」${extra}` }
}

/** 调整归属：只有本探方现场负责人能办；记录人不改，历史里仍保留原记录人。 */
export function reassignStratumOwner(id: number, newOwner: string, operator: string): ActionResult {
  const rows = listRows(STRATUM_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的地层堆积` }
  }
  const row = rows[index]
  const leader = trenchLeader(String(row['所属探方'] ?? ''))
  if (operator !== leader) {
    return { ok: false, message: `调整归属被拦下：只有所属探方 ${String(row['所属探方'])} 的现场负责人「${leader || '未登记'}」能调整归属，当前值班「${operator}」无权` }
  }
  const target = newOwner.trim()
  if (target === '') {
    return { ok: false, message: '新归属人不能为空' }
  }
  const oldOwner = String(row['归属人'] ?? '')
  if (target === oldOwner) {
    return { ok: false, message: `层位 ${String(row['层位编号'])} 已经归属「${target}」，不用重复调整` }
  }
  let next: EntryRow = { ...row, 归属人: target }
  next = appendHistory(next, '归属历史', { 时间: nowLabel(), 原归属人: oldOwner, 新归属人: target, 操作人: operator })
  next = appendHistory(next, '编录历史', {
    时间: nowLabel(),
    记录人: operator,
    事件: `归属由「${oldOwner}」调整为「${target}」，历史记录仍保留原记录人`,
  })
  const nextRows = [...rows]
  nextRows[index] = next
  saveRows(STRATUM_KEY, nextRows)
  return { ok: true, message: `层位 ${String(row['层位编号'])} 归属已调整为「${target}」，原记录人「${String(row['记录人'])}」在历史中保留` }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
