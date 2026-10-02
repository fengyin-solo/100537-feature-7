import { filterRows, moduleMeta } from '@/api/local-service'
import { formatStratumCode } from '@/data/stratum-code'
import { listRows, nextId, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, HistoryEntry, PageResult } from '@/data/types'

const STRATUM_KEY = 'stratum'
const TRENCH_KEY = 'trench'

// 只有这几个状态允许归属负责人改字段；离开编录阶段后一律只读，要改先退回。
const EDITABLE_STATUS = ['待编录', '编录中']
// 观察类字段：退回编录时必须清空重填，判定年代属于研究结论，不在清空范围内。
const OBSERVATION_FIELDS = ['土质', '土色', '包含物', '堆积厚度']
const TERMINAL_STATUS = '已合并'

export type StratumInput = {
  所属探方: string
  土质?: string
  土色?: string
  包含物?: string
  堆积厚度?: string
  判定年代?: string
  堆积状态?: string
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function strata(): EntryRow[] {
  return listRows(STRATUM_KEY)
}

function trenches(): EntryRow[] {
  return listRows(TRENCH_KEY)
}

function persist(rows: EntryRow[]): void {
  saveRows(STRATUM_KEY, rows)
}

function findTrench(code: string): EntryRow | undefined {
  return trenches().find((row) => String(row.探方编号) === code)
}

function findStratum(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((row) => Number(row.id) === id)
}

function historyOf(row: EntryRow): HistoryEntry[] {
  const value = row.历史记录
  return Array.isArray(value) ? (value as HistoryEntry[]) : []
}

function appendHistory(row: EntryRow, action: string, operator: string, detail: string): EntryRow {
  const entry: HistoryEntry = { time: nowText(), action, operator, detail }
  return { ...row, 历史记录: [...historyOf(row), entry] }
}

function isPendingStatus(status: string): boolean {
  return status !== '已复核' && status !== TERMINAL_STATUS
}

/** 清单页与详情页的层位编号统一取这里：编号只存一份，页面不允许各自拼。 */
export function stratumCodeOf(row: EntryRow): string {
  return String(row.层位编号 ?? formatStratumCode(String(row.所属探方 ?? ''), Number(row.seq ?? 0)))
}

/** 当前归属实时以探方台账的现场负责人为准；台账换人，归属跟着变。 */
export function ownerOf(row: EntryRow): string {
  return String(findTrench(String(row.所属探方))?.现场负责人 ?? row.归属负责人 ?? '')
}

export function canEdit(row: EntryRow, operator: string): boolean {
  return ownerOf(row) === operator && EDITABLE_STATUS.includes(String(row.status))
}

/** 越权、越阶段时给出可读的拒因，页面和动作按钮共用这一份说法。 */
export function denyReason(row: EntryRow, operator: string): string {
  const code = stratumCodeOf(row)
  const trenchCode = String(row.所属探方)
  const owner = ownerOf(row)
  const status = String(row.status)
  if (status === TERMINAL_STATUS) {
    return `层位 ${code} 已合并，记录封存只读，任何人不能改动`
  }
  if (owner !== operator) {
    return `层位 ${code} 归属探方 ${trenchCode}（现场负责人：${owner || '未定'}），当前值班人 ${operator} 没有归属权限，该层位只读`
  }
  if (status === '待复核' || status === '已复核') {
    return `层位 ${code} 已${status === '待复核' ? '送交复核' : '复核'}，编录字段锁定；如内容有误，请由资料复核员「退回编录」后再改`
  }
  return ''
}

export function listStrata(filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(strata(), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getStratum(id: number): EntryRow | undefined {
  return strata().find((row) => Number(row.id) === id)
}

export function duplicateCode(rows: EntryRow[], code: string, exceptId?: number): boolean {
  return rows.some((row) => Number(row.id) !== exceptId && stratumCodeOf(row) === code)
}

export function createStratum(input: StratumInput, operator: string): ActionResult {
  const trenchCode = input.所属探方.trim()
  const trench = findTrench(trenchCode)
  if (!trench) {
    return { ok: false, message: `探方台账里没有「${trenchCode}」这个探方，层位必须归属到已登记的探方` }
  }
  const owner = String(trench.现场负责人)
  if (owner !== operator) {
    return { ok: false, message: `你不是探方 ${trenchCode} 的现场负责人（负责人：${owner}），不能在该探方下登记层位` }
  }
  const rows = strata()
  const seq = rows.filter((row) => String(row.所属探方) === trenchCode).length + 1
  const code = formatStratumCode(trenchCode, seq)
  if (duplicateCode(rows, code)) {
    return { ok: false, message: `层位编号 ${code} 已存在，重复编号不允许保存` }
  }
  const id = nextId(rows)
  let row: EntryRow = {
    id,
    status: '待编录',
    pending: true,
    abnormal: false,
    层位编号: code,
    所属探方: trenchCode,
    归属负责人: owner,
    // 原记录人取首次登记人，后续归属调整也不覆盖。
    原记录人: operator,
    seq,
    土质: input.土质?.trim() ?? '',
    土色: input.土色?.trim() ?? '',
    包含物: input.包含物?.trim() ?? '',
    堆积厚度: input.堆积厚度?.trim() ?? '',
    判定年代: input.判定年代?.trim() ?? '',
    堆积状态: input.堆积状态?.trim() ?? '自然堆积',
    历史记录: [],
  }
  row = appendHistory(row, '登记层位', operator, `层位 ${code} 登记，归属探方 ${trenchCode}，原记录人${operator}`)
  persist([...rows, row])
  return { ok: true, message: `层位 ${code} 已登记，归属 ${owner}，状态「待编录」` }
}

export function editStratum(id: number, patch: Partial<Record<string, string>>, operator: string): ActionResult {
  const rows = strata()
  const index = rows.findIndex((row) => Number(row.id) === id)
  const target = rows[index]
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的层位` }
  }
  const reason = denyReason(target, operator)
  if (reason) {
    return { ok: false, message: `改动被拦下：${reason}` }
  }
  const allowed = [...OBSERVATION_FIELDS, '判定年代', '堆积状态']
  const touched = Object.entries(patch).filter(
    ([key, value]) => allowed.includes(key) && String(value ?? '').trim() !== String(target[key] ?? ''),
  )
  if (touched.length === 0) {
    return { ok: false, message: '没有检测到字段变化，无需保存' }
  }
  const updated: EntryRow = { ...target }
  for (const [key, value] of touched) {
    updated[key] = String(value ?? '').trim()
  }
  const detail = touched.map(([key, value]) => `${key}改为「${String(value ?? '').trim() || '空'}」`).join('；')
  persist([...rows.slice(0, index), appendHistory(updated, '编录修改', operator, detail), ...rows.slice(index + 1)])
  return { ok: true, message: `层位 ${stratumCodeOf(target)} 的改动已保存` }
}

/** 复核员专属动作（复核通过 / 退回编录 / 合并层位）的统一校验。 */
function reviewerOnly(action: string, operator: string, isReviewer: boolean): ActionResult | null {
  if (!isReviewer) {
    return { ok: false, message: `「${action}」是资料复核员的权限，${operator} 不能执行；编录归属与现场负责人意见不一致时，以编录归属为准，个人意见不能直接改写记录` }
  }
  return null
}

export function stratumAction(id: number, action: string, operator: string, isReviewer: boolean): ActionResult {
  const meta = moduleMeta(STRATUM_KEY)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `地层堆积没有登记「${action}」这个动作` }
  }
  const rows = strata()
  const index = rows.findIndex((row) => Number(row.id) === id)
  const current = rows[index]
  if (!current) {
    return { ok: false, message: `没有找到编号为 ${id} 的层位` }
  }
  const code = stratumCodeOf(current)
  const status = String(current.status)

  if (action === '复核通过' || action === '退回编录' || action === '合并层位') {
    const blocked = reviewerOnly(action, operator, isReviewer)
    if (blocked) return blocked
  } else {
    // 提交编录、送交复核是归属负责人的活；没有归属权限直接只读拦截。
    if (ownerOf(current) !== operator) {
      return { ok: false, message: `操作被拦下：${denyReason(current, operator)}` }
    }
  }

  if (action === '提交编录' && status !== '待编录' && status !== '编录中') {
    return { ok: false, message: `层位 ${code} 当前「${status}」，不能再提交编录` }
  }
  if (action === '送交复核') {
    if (status !== '编录中') {
      return { ok: false, message: `层位 ${code} 当前「${status}」，只有编录中的层位能送交复核` }
    }
    const missing = OBSERVATION_FIELDS.filter((field) => String(current[field] ?? '').trim() === '')
    if (missing.length > 0) {
      return { ok: false, message: `层位 ${code} 的 ${missing.join('、')} 还没填，不能送交复核` }
    }
  }
  if (action === '复核通过' && status !== '待复核') {
    return { ok: false, message: `层位 ${code} 当前「${status}」，只有待复核的层位能复核通过` }
  }
  if (action === '退回编录' && status !== '待复核' && status !== '已复核') {
    return { ok: false, message: `层位 ${code} 当前「${status}」，无须退回` }
  }
  if (action === '合并层位' && status !== '待复核' && status !== '已复核') {
    return { ok: false, message: `层位 ${code} 当前「${status}」，须复核后才能合并` }
  }
  if (status === target) {
    return { ok: false, message: `层位 ${code} 已经是「${target}」，不用重复操作` }
  }

  let updated: EntryRow = { ...current, status: target, pending: isPendingStatus(target) }
  if (action === '退回编录') {
    // 退回不是打回旧值：观察字段全部清空，强制归属负责人重新填报。
    for (const field of OBSERVATION_FIELDS) {
      updated[field] = ''
    }
    updated = appendHistory(
      updated,
      '退回编录',
      operator,
      `复核未通过，退回编录重填；土质、土色、包含物、堆积厚度已清空，不留旧值`,
    )
  } else if (action === '送交复核') {
    updated = appendHistory(updated, action, operator, '编录内容填齐，送交资料复核员复核')
  } else if (action === '复核通过') {
    updated = appendHistory(updated, action, operator, '编录内容与现场遗迹现象一致，复核通过')
  } else if (action === '合并层位') {
    updated = appendHistory(updated, action, operator, '层位合并，记录封存')
  } else {
    updated = appendHistory(updated, action, operator, `状态流转为「${target}」`)
  }
  persist([...rows.slice(0, index), updated, ...rows.slice(index + 1)])
  return { ok: true, message: `层位 ${code} 已${action}，当前状态「${target}」` }
}

/** 归属调整：仅资料复核员可办；层位换到新探方后按新探方流水号重新编号，原记录人保留。 */
export function reassignStratum(id: number, targetTrenchCode: string, operator: string, isReviewer: boolean): ActionResult {
  if (!isReviewer) {
    return { ok: false, message: `归属调整被拦下：只有资料复核员能调整编录归属，${operator} 没有该权限` }
  }
  const code0 = targetTrenchCode.trim()
  const targetTrench = findTrench(code0)
  if (!targetTrench) {
    return { ok: false, message: `探方台账里没有「${code0}」这个探方，不能归属过去` }
  }
  const rows = strata()
  const index = rows.findIndex((row) => Number(row.id) === id)
  const current = rows[index]
  if (!current) {
    return { ok: false, message: `没有找到编号为 ${id} 的层位` }
  }
  const oldTrench = String(current.所属探方)
  if (oldTrench === code0) {
    return { ok: false, message: `层位 ${stratumCodeOf(current)} 已经归属 ${code0}，不用调整` }
  }
  const oldCode = stratumCodeOf(current)
  const newSeq = rows.filter((row) => String(row.所属探方) === code0).length + 1
  const newCode = formatStratumCode(code0, newSeq)
  if (duplicateCode(rows, newCode, id)) {
    return { ok: false, message: `层位编号 ${newCode} 已存在，重复编号不允许保存` }
  }
  const oldOwner = ownerOf(current)
  const newOwner = String(targetTrench.现场负责人)
  let updated: EntryRow = {
    ...current,
    所属探方: code0,
    seq: newSeq,
    层位编号: newCode,
    归属负责人: newOwner,
    // 原记录人故意不改：归属调整只换管辖权，不抹原始记录责任。
  }
  updated = appendHistory(
    updated,
    '归属调整',
    operator,
    `由 ${oldTrench}（负责人${oldOwner}）调整至 ${code0}（负责人${newOwner}），编号 ${oldCode}→${newCode}；原记录人${String(current.原记录人)}保留不变`,
  )
  persist([...rows.slice(0, index), updated, ...rows.slice(index + 1)])
  return { ok: true, message: `层位已调整为 ${newCode}，归属 ${newOwner}；原记录人 ${String(current.原记录人)} 保留` }
}

export type StratumStats = { label: string; value: number }[]

export function stratumStats(): StratumStats {
  const rows = strata()
  const count = (status: string) => rows.filter((row) => String(row.status) === status).length
  return [
    { label: '待编录层位', value: count('待编录') },
    { label: '编录中层位', value: count('编录中') },
    { label: '待复核层位', value: count('待复核') },
    { label: '已复核层位', value: count('已复核') },
  ]
}
