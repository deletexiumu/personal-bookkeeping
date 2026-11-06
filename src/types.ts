import type { FieldKey } from './lib/import/fields'
import type { AmountSign } from './lib/import/table'

/**
 * 同步用的元数据，所有会同步的表都有，由 src/db/sync.ts 的中间件自动维护，业务代码不用管：
 * - uid：跨设备唯一的记录编号（本地自增 id 只在这台设备上有效）
 * - modifiedAt：本机最后修改时间（毫秒），多设备改同一条时以较晚的为准
 * - dirty：1 表示本机改过、还没推送到云端
 */
export interface SyncMeta {
  uid?: string
  modifiedAt?: number
  dirty?: 1
}

/** 收支类型。转账在账户间移动资金，不计入收入和支出。 */
export type TransactionType = 'expense' | 'income' | 'transfer'

/** 分类只区分支出和收入 */
export type CategoryType = Exclude<TransactionType, 'transfer'>

/** 记录来源：手动记账、账单导入、开放接口、自动规则 */
export type TransactionSource = 'manual' | 'import' | 'api' | 'rule'

/** 一笔收支记录。金额以「分」为单位的整数存储，避免浮点误差。 */
export interface Transaction extends SyncMeta {
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
  /** 导入批次，用于整批撤销 */
  importBatchId?: number
  /** 外部交易单号（账单导入），用于重复导入时精确去重 */
  externalId?: string
  /**
   * 不计收支：本人账户之间挪钱（余额宝转入、钱包提现等）又找不到另一边时，保留明细，不计入收入、支出、
   * 预算和分析。钱包账单导入的（有交易单号）也不计入账户余额，因为方向常常不可靠，见 computeBalances
   */
  excluded?: boolean
  /**
   * 合并进来的流水明细：钱包账单与银行流水（或手记）是同一笔钱时合并成这一条，
   * 统计只算一次，这里保留银行流水那一侧的原始信息
   */
  merged?: MergedEntry[]
  createdAt: number
  updatedAt: number
}

/** 合并进一笔流水的另一条明细，只存展示用的文字，不存本地 ID（同步到其他设备时 ID 不通用） */
export interface MergedEntry {
  /** 来源说明，如「招商银行流水」「手记」 */
  label: string
  date: string
  time?: string
  merchant?: string
  note?: string
  /** 原来所在的账户名 */
  account?: string
  /** 这一行来自银行流水（用来识别重复导入，已经合并过银行流水的不再合并） */
  bank?: boolean
  /** 原金额（分），与合并后的金额不同时记下，如提现扣了手续费 */
  amount?: number
  /** 原交易单号 */
  ref?: string
  /** 这一行是退款：部分退款并进原支出时，原支出的金额已减掉它 */
  refund?: boolean
}

/** 分类和账户图标的配色，对应 tokens.css 中的语义色 / 图表色 */
export type Tone = 'orange' | 'blue' | 'red' | 'green' | 'purple' | 'cyan' | 'gray'

export interface Category extends SyncMeta {
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

export interface Account extends SyncMeta {
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
export interface Budget extends SyncMeta {
  id?: number
  categoryId?: number
  /** 每月金额（分） */
  amount: number
}

/** 账单来源 */
export type ImportSource = 'wechat' | 'alipay' | 'douyin' | 'bank' | 'csv' | 'json'

/** 一次导入：用于导入记录与整批撤销 */
export interface ImportBatch extends SyncMeta {
  id?: number
  source: ImportSource
  fileName: string
  /** 文件中的数据行数 */
  rowCount: number
  /** 实际入账条数 */
  importedCount: number
  /** 与已有流水合并的条数（不新增记录） */
  mergedCount?: number
  createdAt: number
  status: 'done' | 'reverted'
  revertedAt?: number
}

/** 规则匹配的字段：商户、备注，或两者任一 */
export type RuleField = 'merchant' | 'note' | 'any'

/** 匹配方式：包含关键词，或完全等于 */
export type RuleMatch = 'contains' | 'equals'

/**
 * 自动分类规则：导入时命中的流水归到 categoryId（分类的收支类型决定规则适用的方向）。
 * order 越小优先级越高，用户规则优先于历史同商户和内置关键词。
 */
export interface CategoryRule extends SyncMeta {
  id?: number
  field: RuleField
  match: RuleMatch
  keyword: string
  categoryId: number
  order?: number
  createdAt?: number
}

/** 用户保存的字段映射模板：表头一致时下次自动套用，跳过字段映射 */
export interface ImportTemplate extends SyncMeta {
  id?: number
  name: string
  /** 表头（去掉空白），用于识别 */
  headers: string[]
  /** 与 headers 一一对应的目标字段 */
  columns: FieldKey[]
  amountSign: AmountSign
  /** 默认入账账户 */
  accountId?: number
  createdAt: number
}
