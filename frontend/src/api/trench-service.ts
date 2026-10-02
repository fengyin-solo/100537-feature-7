import { LEDGER_KEY, listLedger, listRows, nextId, saveLedger, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

const STRATUM_KEY = 'stratum'
const TRENCH_KEY = 'trench'

// 编录阶段未结束的状态：出结论前必须全部走完，不能把半截编录回写成台账。
const OPEN_CATALOG_STATUS = ['待编录', '编录中']

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function trenchRows(): EntryRow[] {
  return listRows(TRENCH_KEY)
}

function stratumRows(): EntryRow[] {
  return listRows(STRATUM_KEY)
}

export function ledgerRows(): EntryRow[] {
  return listLedger()
}

/** 本探方编录出结论：待复核数量回写探方台账，并给台账加一条待处理记录。 */
export function concludeTrench(trenchId: number, operator: string): ActionResult {
  const trenches = trenchRows()
  const index = trenches.findIndex((row) => Number(row.id) === trenchId)
  const trench = trenches[index]
  if (!trench) {
    return { ok: false, message: `没有找到编号为 ${trenchId} 的探方` }
  }
  const code = String(trench.探方编号)
  const owner = String(trench.现场负责人)
  if (owner !== operator) {
    return {
      ok: false,
      message: `出结论被拦下：探方 ${code} 归属现场负责人 ${owner}，当前值班人 ${operator} 只能查看，不能替本探方出编录结论`,
    }
  }
  const mine = stratumRows().filter((row) => String(row.所属探方) === code)
  if (mine.length === 0) {
    return { ok: false, message: `探方 ${code} 还没有登记任何层位，无结论可出` }
  }
  const open = mine.filter((row) => OPEN_CATALOG_STATUS.includes(String(row.status)))
  if (open.length > 0) {
    return {
      ok: false,
      message: `探方 ${code} 还有 ${open.length} 个层位处于待编录/编录中，编录未完成，不能出结论`,
    }
  }
  const pendingReview = mine.filter((row) => String(row.status) === '待复核').length

  const updatedTrench: EntryRow = { ...trench, 待复核数量: pendingReview }
  saveRows(TRENCH_KEY, [...trenches.slice(0, index), updatedTrench, ...trenches.slice(index + 1)])

  const ledger = listLedger()
  const record: EntryRow = {
    id: nextId(ledger),
    status: '待处理',
    pending: true,
    abnormal: false,
    探方编号: code,
    现场负责人: owner,
    待复核数量: pendingReview,
    来源: '编录结论',
    发生时间: nowText(),
    说明:
      pendingReview > 0
        ? `探方 ${code} 编录阶段出结论，${pendingReview} 个层位待复核，请资料复核员安排复核`
        : `探方 ${code} 编录阶段出结论，层位均已复核，台账归档备查`,
  }
  saveLedger([...ledger, record])
  return {
    ok: true,
    message: `探方 ${code} 编录结论已回写台账：待复核 ${pendingReview} 个，台账新增一条待处理记录`,
  }
}

/** 待处理记录办结：资料复核员复核完该探方层位后手动关闭。 */
export function settleLedger(recordId: number, operator: string, isReviewer: boolean): ActionResult {
  if (!isReviewer) {
    return { ok: false, message: `办结被拦下：台账待处理记录只有资料复核员能办结，${operator} 没有该权限` }
  }
  const rows = listLedger()
  const index = rows.findIndex((row) => Number(row.id) === recordId)
  const current = rows[index]
  if (!current) {
    return { ok: false, message: `没有找到编号为 ${recordId} 的台账记录` }
  }
  if (String(current.status) === '已办结') {
    return { ok: false, message: '该台账记录已经办结，不用重复操作' }
  }
  const updated: EntryRow = { ...current, status: '已办结', pending: false, 办结人: operator, 办结时间: nowText() }
  saveLedger([...rows.slice(0, index), updated, ...rows.slice(index + 1)])
  return { ok: true, message: `探方 ${String(current.探方编号)} 的待处理记录已办结` }
}

export { LEDGER_KEY }
