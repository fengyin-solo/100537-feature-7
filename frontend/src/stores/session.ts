import { defineStore } from 'pinia'

// 当前值班人持久化：换班刷新后身份还在，演示归属权限时不用重选。
const OPERATOR_KEY = 'archaeology-field:operator'

function initialOperator(): string {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem(OPERATOR_KEY)
    if (saved) {
      return saved
    }
  }
  return '王岚'
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: initialOperator(),
    // 现场名册：王岚负责 TREN-0001/TREN-0003，陈岩负责 TREN-0002，其余为编录员与管理员。
    roster: ['王岚', '陈岩', '李青', '周敏', '赵启', '值班管理员'],
    shiftLabel: '白班 08:00-20:00',
    scope: '考古发掘现场记录与出土物整理工作台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(name: string) {
      this.operator = name
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(OPERATOR_KEY, name)
      }
    },
  },
})
