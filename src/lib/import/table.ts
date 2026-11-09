import { MULTI_FIELDS, matchHeader, type FieldKey } from './fields'
import { isVoidStatus, parseDateCell, parseDirection, parseMoneyCell, parseTimeCell } from './normalize'

/** 一张已解析的表：表头所在行、表头、数据行（含原始行号） */
export interface SheetTable {
  headerRow: number
  headers: string[]
  rows: { line: number; cells: string[] }[]
}

/**
 * 找表头所在行：在前 40 行里找表头关键词命中最多的一行（至少 2 个）。
 * 微信、支付宝等账单前面有若干说明行，表头不在第一行。找不到时返回 0。
 */
export function findHeaderRow(rows: string[][]): number {
  let best = 0
  let bestScore = 1
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const score = rows[i].filter((cell) => matchHeader(cell) !== undefined).length
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  return best
}

/**
 * 以 headerRow 行为表头切出数据行。非空单元格少于表头一半的行视为说明行或汇总行，丢弃。
 */
export function toTable(rows: string[][], headerRow: number): SheetTable {
  const headers = (rows[headerRow] ?? []).map((h, i) => h || `第 ${i + 1} 列`)
  const minCells = Math.max(2, Math.ceil(headers.filter((h) => h !== '').length / 2))
  const data: SheetTable['rows'] = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const cells = rows[i]
    if (cells.filter((c) => c !== '').length < minCells) continue
    if (/^-{3,}/.test(cells[0] ?? '')) continue
    data.push({ line: i + 1, cells: headers.map((_, col) => cells[col] ?? '') })
  }
  return { headerRow, headers, rows: data }
}

export type MappingStatus = 'matched' | 'confirm' | 'skip'

export interface ColumnMapping {
  field: FieldKey
  status: MappingStatus
}

function samplesOf(table: SheetTable, col: number, limit = 20): string[] {
  const out: string[] = []
  for (const row of table.rows) {
    const v = row.cells[col]
    if (v) out.push(v)
    if (out.length >= limit) break
  }
  return out
}

function mostly(values: string[], test: (v: string) => boolean, ratio = 0.8): boolean {
  return values.length > 0 && values.filter(test).length / values.length >= ratio
}

/**
 * 自动映射：先按表头关键词，再结合示例值修正（「交易时间」里是完整日期时间就当日期列，
 * 「交易类型」里是「支出 / 收入」就当收支方向列），最后给没有命中的列按示例值猜测（需确认）。
 * 账户列总是标为需确认，因为文件里的账户名不一定和本地账户一致。
 */
export function autoMap(table: SheetTable): ColumnMapping[] {
  const used = new Set<FieldKey>()
  const take = (field: FieldKey) => {
    if (used.has(field) && !MULTI_FIELDS.has(field)) return false
    used.add(field)
    return true
  }
  const result: ColumnMapping[] = table.headers.map(() => ({ field: 'ignore', status: 'skip' }))

  table.headers.forEach((header, col) => {
    const samples = samplesOf(table, col)
    let field = matchHeader(header)
    if (field === 'time' && mostly(samples, (v) => parseDateCell(v) !== null)) field = 'date'
    if (field === 'date' && !mostly(samples, (v) => parseDateCell(v) !== null) && mostly(samples, (v) => parseTimeCell(v) !== null))
      field = 'time'
    if (field === 'note' && !used.has('direction') && mostly(samples, (v) => parseDirection(v) !== null, 0.6)) field = 'direction'
    if (field && take(field)) result[col] = { field, status: field === 'account' ? 'confirm' : 'matched' }
  })

  // 表头没认出来的列，按示例值猜
  table.headers.forEach((_, col) => {
    if (result[col].field !== 'ignore') return
    const samples = samplesOf(table, col)
    const guess: FieldKey | undefined = mostly(samples, (v) => parseDateCell(v) !== null)
      ? 'date'
      : mostly(samples, (v) => parseMoneyCell(v) !== null && /\d\.\d{2}$/.test(v))
        ? 'amount'
        : undefined
    if (guess && !used.has(guess) && !(guess === 'amount' && (used.has('expense') || used.has('income')))) {
      used.add(guess)
      result[col] = { field: guess, status: 'confirm' }
    }
  })
  return result
}

/** 映射是否足够解析：要有日期，以及金额或支出 / 收入金额 */
export function mappingProblems(mapping: ColumnMapping[]): string[] {
  const fields = new Set(mapping.map((m) => m.field))
  const problems: string[] = []
  if (!fields.has('date')) problems.push('请指定日期列')
  if (!fields.has('amount') && !fields.has('expense') && !fields.has('income')) problems.push('请指定金额列')
  return problems
}

/** 金额正负约定：多数账单「负数为支出」，部分信用卡账单「正数为支出」 */
export type AmountSign = 'negative-expense' | 'positive-expense'

export interface ParsedRow {
  line: number
  date: string
  time?: string
  type: 'expense' | 'income'
  /** 金额（分），恒为正 */
  amount: number
  merchant?: string
  /**
   * 用于匹配的说明文字：商品说明和备注 / 摘要用「 · 」拼在一起（分类规则、去重、合并都按它比对）。
   * 写入流水时商品说明和备注分开存，见 goods、remark
   */
  note?: string
  /** 账单里的商品说明（单独映射了商品说明列时才有） */
  goods?: string
  /** 备注 / 摘要列的内容（不含商品说明） */
  remark?: string
  categoryName?: string
  accountName?: string
  ref?: string
  /** 商户单号 */
  merchantRef?: string
  /** 账单里的交易类型（如微信的「微信红包」「转账」），只用于自动分类 */
  kind?: string
  /** 不建议入账的原因，例如交易关闭、不计收支；预览中默认不勾选 */
  skipReason?: string
}

export interface RowError {
  line: number
  reason: string
}

export interface ParseResult {
  rows: ParsedRow[]
  errors: RowError[]
}

/** 按映射把数据行转成标准流水 */
export function parseRows(table: SheetTable, mapping: ColumnMapping[], amountSign: AmountSign = 'negative-expense'): ParseResult {
  const rows: ParsedRow[] = []
  const errors: RowError[] = []
  const colsOf = (field: FieldKey) => mapping.flatMap((m, i) => (m.field === field ? [i] : []))
  const first = (cells: string[], field: FieldKey) => {
    const col = colsOf(field)[0]
    return col === undefined ? '' : (cells[col] ?? '').trim()
  }
  const joined = (cells: string[], field: FieldKey) =>
    colsOf(field)
      .map((c) => (cells[c] ?? '').trim())
      .filter((v) => v !== '' && v !== '/')
      .join(' · ')

  const isRefund = (cells: string[]) =>
    ['category', 'kind', 'goods', 'note', 'status'].some((f) => /退款/.test(joined(cells, f as FieldKey)))
  const isRepayment = (cells: string[]) =>
    ['category', 'kind', 'goods', 'note', 'merchant'].some((f) => /还款/.test(joined(cells, f as FieldKey)))

  for (const { line, cells } of table.rows) {
    const dt = parseDateCell(first(cells, 'date'))
    if (!dt) {
      errors.push({ line, reason: '日期无法识别' })
      continue
    }
    const time = dt.time ?? (parseTimeCell(first(cells, 'time')) || undefined)

    let type: ParsedRow['type'] | undefined
    let amount: number | null = null
    let skipReason: string | undefined
    const direction = parseDirection(first(cells, 'direction'))
    const expenseCell = parseMoneyCell(first(cells, 'expense'))
    const incomeCell = parseMoneyCell(first(cells, 'income'))
    if (expenseCell) {
      type = 'expense'
      amount = Math.abs(expenseCell)
    } else if (incomeCell) {
      type = 'income'
      amount = Math.abs(incomeCell)
    } else {
      const signed = parseMoneyCell(first(cells, 'amount'))
      if (signed !== null && signed !== 0) {
        amount = Math.abs(signed)
        if (direction === 'expense' || direction === 'income') type = direction
        else {
          const negative = signed < 0
          type = negative === (amountSign === 'negative-expense') ? 'expense' : 'income'
          if (direction === 'neutral') skipReason = '不计收支'
        }
        // 支付宝把退款记为「不计收支」，按收入入账，否则原来那笔支出会一直多算
        if (direction === 'neutral' && isRefund(cells)) {
          type = 'income'
          skipReason = undefined
        } else if (direction === 'neutral' && isRepayment(cells)) {
          // 花呗、借呗、信用卡还款也是「不计收支」，按支出入账：还的是之前用掉的钱，没导入那边的账单时这是唯一的记录
          type = 'expense'
          skipReason = undefined
        }
      }
    }
    if (!type || !amount) {
      errors.push({ line, reason: '金额无法识别或为 0' })
      continue
    }
    const status = first(cells, 'status')
    if (status && isVoidStatus(status)) skipReason = status
    const row: ParsedRow = { line, date: dt.date, type, amount }
    if (time) row.time = time
    const merchant = joined(cells, 'merchant')
    const goods = joined(cells, 'goods')
    const remark = joined(cells, 'note')
    const note = [goods, remark].filter(Boolean).join(' · ')
    const categoryName = first(cells, 'category')
    const accountName = first(cells, 'account')
    const ref = first(cells, 'ref')
    const merchantRef = first(cells, 'merchantRef')
    const kind = first(cells, 'kind')
    if (merchant) row.merchant = merchant
    if (note) row.note = note
    if (goods) row.goods = goods
    if (remark && goods) row.remark = remark
    if (categoryName) row.categoryName = categoryName
    if (accountName && accountName !== '/') row.accountName = accountName
    if (ref) row.ref = ref
    if (merchantRef && merchantRef !== '/') row.merchantRef = merchantRef
    if (kind && kind !== '/') row.kind = kind
    if (skipReason) row.skipReason = skipReason
    rows.push(row)
  }
  return { rows, errors }
}
