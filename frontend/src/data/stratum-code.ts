// 层位编号规则：探方号 + 流水号拼成，全站只允许走这一个函数，清单页与详情页读到的编号必然一致。
export function formatStratumCode(trenchCode: string, seq: number): string {
  return `${trenchCode}-${String(seq).padStart(2, '0')}`
}
