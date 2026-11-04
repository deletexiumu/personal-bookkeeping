/** 单元格解析：日期、时间、金额、收支方向。都是纯函数，不合法时返回 null。 */

export interface DateTime {
  date: string
  time?: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  return d <= new Date(y, m, 0).getDate()
}

function validTime(h: number, min: number): boolean {
  return h >= 0 && h < 24 && min >= 0 && min < 60
}

/**
 * 解析日期（可带时间）：2026-10-31、2026/10/31、2026.10.31、2026年10月31日、20261031，
 * 后面可跟 12:08 或 12:08:33。
 */
export function parseDateCell(input: string): DateTime | null {
  const text = input.trim()
  const m =
    /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(text) ??
    /^(\d{4})(\d{2})(\d{2})(?:\s*(\d{2}):?(\d{2})(?::?\d{2})?)?$/.exec(text)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (!validDate(y, mo, d)) return null
  const date = `${y}-${pad(mo)}-${pad(d)}`
  if (m[4] === undefined) return { date }
  const [h, min] = [Number(m[4]), Number(m[5])]
  if (!validTime(h, min)) return null
  return { date, time: `${pad(h)}:${pad(min)}` }
}

/** 解析时间：12:08、12:08:33、1208 → HH:mm */
export function parseTimeCell(input: string): string | null {
  const m = /^(\d{1,2}):?(\d{2})(?::?\d{2})?$/.exec(input.trim())
  if (!m) return null
  const [h, min] = [Number(m[1]), Number(m[2])]
  return validTime(h, min) ? `${pad(h)}:${pad(min)}` : null
}

/**
 * 解析金额为带符号的分：去掉 ¥ ￥ 元 RMB CNY、千分位逗号和空白；
 * 支持 +/- 号、括号表示负数和尾随负号；超过两位小数四舍五入。
 */
export function parseMoneyCell(input: string): number | null {
  let text = input.replace(/[\s,，¥￥元]|RMB|CNY/gi, '')
  if (text === '') return null
  let negative = false
  if (/^\(.*\)$/.test(text) || /^（.*）$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  if (/^[+-]/.test(text)) {
    negative = negative !== (text[0] === '-')
    text = text.slice(1)
  } else if (/-$/.test(text)) {
    negative = !negative
    text = text.slice(0, -1)
  }
  const m = /^(\d+)(?:\.(\d*))?$/.exec(text)
  if (!m) return null
  const fraction = (m[2] ?? '').padEnd(3, '0')
  let cents = Number(m[1]) * 100 + Number(fraction.slice(0, 2))
  if (Number(fraction[2]) >= 5) cents += 1
  if (!Number.isSafeInteger(cents)) return null
  return negative && cents !== 0 ? -cents : cents
}

export type Direction = 'expense' | 'income' | 'neutral'

/** 解析收支方向：支出 / 支 / 消费 / 付款 / 借，收入 / 收 / 退款 / 收款 / 贷，「/」或「不计收支」为中性 */
export function parseDirection(input: string): Direction | null {
  const text = input.trim()
  if (text === '') return null
  if (/^[/／-]$|不计收支|中性/.test(text)) return 'neutral'
  if (/支出|^支$|消费|付款|支付|转出|扣款|^借$|^出$/.test(text)) return 'expense'
  if (/收入|^收$|退款|收款|转入|入账|^贷$|^入$/.test(text)) return 'income'
  return null
}

/** 交易状态为关闭、失败、撤销等的不入账 */
export function isVoidStatus(input: string): boolean {
  return /关闭|失败|撤销|已取消|取消/.test(input)
}
