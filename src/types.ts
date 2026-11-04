/** 收支类型 */
export type TransactionType = 'expense' | 'income'

/** 一笔收支记录。金额以「分」为单位的整数存储，避免浮点误差。 */
export interface Transaction {
  id?: number
  type: TransactionType
  /** 金额（分），恒为正数，方向由 type 决定 */
  amount: number
  categoryId: number
  accountId: number
  /** 发生日期，格式 YYYY-MM-DD */
  date: string
  note?: string
  createdAt: number
  updatedAt: number
}

export interface Category {
  id?: number
  name: string
  type: TransactionType
  icon?: string
}

export interface Account {
  id?: number
  name: string
}
