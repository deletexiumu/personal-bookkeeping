/** 收支类型。转账在账户间移动资金，不计入收入和支出。 */
export type TransactionType = 'expense' | 'income' | 'transfer'

/** 分类只区分支出和收入 */
export type CategoryType = Exclude<TransactionType, 'transfer'>

/** 记录来源：手动记账、账单导入、开放接口、自动规则 */
export type TransactionSource = 'manual' | 'import' | 'api' | 'rule'

/** 一笔收支记录。金额以「分」为单位的整数存储，避免浮点误差。 */
export interface Transaction {
  id?: number
  type: TransactionType
  /** 金额（分），恒为正数，方向由 type 决定 */
  amount: number
  /** 分类；转账没有分类 */
  categoryId?: number
  /** 账户；转账时为转出账户 */
  accountId: number
  /** 转账时的转入账户 */
  transferAccountId?: number
  /** 发生日期，格式 YYYY-MM-DD */
  date: string
  /** 发生时间，格式 HH:mm，可选 */
  time?: string
  note?: string
  /** 商户 / 交易对方，多来自账单导入 */
  merchant?: string
  /** 标签，不含 # */
  tags?: string[]
  source: TransactionSource
  /** 导入批次（W4），用于整批撤销 */
  importBatchId?: number
  createdAt: number
  updatedAt: number
}

/** 分类和账户图标的配色，对应 tokens.css 中的语义色 / 图表色 */
export type Tone = 'orange' | 'blue' | 'red' | 'green' | 'purple' | 'cyan' | 'gray'

export interface Category {
  id?: number
  name: string
  type: CategoryType
  /** 图标键名，见 src/components/icons.ts */
  icon?: string
  color?: Tone
  /** 排序，越小越靠前 */
  order?: number
  /** 归档后不再出现在记一笔和筛选中，历史记录保留 */
  archived?: boolean
}

export type AccountType = 'cash' | 'debit' | 'credit' | 'alipay' | 'wechat' | 'other'

export interface Account {
  id?: number
  name: string
  type?: AccountType
  /** 初始余额（分），信用卡可为负数表示欠款 */
  initialBalance?: number
  note?: string
  order?: number
  archived?: boolean
}

/**
 * 月度预算，每月循环生效。不带分类的是总预算，带分类的是该支出分类的预算。
 * 一个分类最多一条（总预算也只有一条）。
 */
export interface Budget {
  id?: number
  categoryId?: number
  /** 每月金额（分） */
  amount: number
}
