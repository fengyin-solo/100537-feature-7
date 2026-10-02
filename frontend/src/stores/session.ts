import { defineStore } from 'pinia'

// 现场可切换的值班人员：现场负责人按探方管辖层位，资料复核员负责复核与归属调整。
export type Staff = {
  name: string
  role: string
}

export const STAFF_LIST: Staff[] = [
  { name: '高翔', role: '现场负责人（T0101/T0102）' },
  { name: '林岚', role: '现场负责人（T0203）' },
  { name: '孟舟', role: '现场负责人（T0305）' },
  { name: '沈确', role: '资料复核员' },
]

export const REVIEWER_NAME = '沈确'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '高翔',
    shiftLabel: '白班 08:00-20:00',
    scope: '考古发掘现场记录与出土物整理工作台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isReviewer: (state) => state.operator === REVIEWER_NAME,
    operatorRole(state): string {
      return STAFF_LIST.find((item) => item.name === state.operator)?.role ?? ''
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(name: string) {
      this.operator = name
    },
  },
})
