/**
 * 记一笔的金额表达式：支持 `12+8.5`、`30-4.5`、`12.5*3`、`100/3` 这样的四则运算。
 * 计算全程以「分」为单位的整数进行，乘除结果四舍五入到分。
 */

const OPERATORS = new Set(['+', '-', '*', '/'])
const MAX_LENGTH = 32

/** 把显示用的 × ÷ − 统一成 ASCII 运算符 */
export function normalizeExpression(input: string): string {
  return input.replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/[−—]/g, '-').replace(/\s+/g, '')
}

export type EvalResult = { ok: true; cents: number } | { ok: false; error: string }

function toCents(num: string): number | null {
  if (!/^\d+(\.\d{0,2})?$/.test(num)) return null
  const [yuan, fen = ''] = num.split('.')
  const cents = Number(yuan) * 100 + Number(fen.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

/**
 * 计算金额表达式，结果为分。结尾多余的运算符会被忽略（便于输入过程中实时预览）。
 * 结果必须大于 0。
 */
export function evaluateAmount(input: string): EvalResult {
  let text = normalizeExpression(input)
  while (text && OPERATORS.has(text.at(-1)!)) text = text.slice(0, -1)
  if (!text) return { ok: false, error: '请输入金额' }

  const tokens = text.split(/([+\-*/])/)
  // tokens 形如 [num, op, num, op, num]
  if (tokens.length % 2 === 0) return { ok: false, error: '金额格式不正确' }

  // 先算乘除，再算加减。乘除的右侧是普通数字，左侧是分。
  const terms: number[] = []
  const signs: number[] = [1]
  let current = toCents(tokens[0])
  if (current === null) return { ok: false, error: '金额最多两位小数' }
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i]
    const right = toCents(tokens[i + 1])
    if (right === null) return { ok: false, error: '金额最多两位小数' }
    if (op === '*') {
      current = Math.round((current * right) / 100)
    } else if (op === '/') {
      if (right === 0) return { ok: false, error: '不能除以 0' }
      current = Math.round((current * 100) / right)
    } else {
      terms.push(current)
      signs.push(op === '+' ? 1 : -1)
      current = right
    }
  }
  terms.push(current)
  const cents = terms.reduce((sum, term, i) => sum + signs[i] * term, 0)
  if (!Number.isSafeInteger(cents)) return { ok: false, error: '金额过大' }
  if (cents <= 0) return { ok: false, error: '金额必须大于 0' }
  return { ok: true, cents }
}

/** 表达式里是否含有运算（用于决定是否显示「= 结果」） */
export function hasOperation(input: string): boolean {
  return /\d[+\-*/]\d/.test(normalizeExpression(input))
}

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '+' | '-' | '*' | '/' | 'backspace'

/** 处理金额键盘的一次按键，返回新的表达式；不合法的按键原样返回 */
export function applyKey(expr: string, key: KeypadKey): string {
  const text = normalizeExpression(expr)
  if (key === 'backspace') return text.slice(0, -1)
  if (text.length >= MAX_LENGTH) return text

  const last = text.at(-1)
  const segment = text.split(/[+\-*/]/).at(-1) ?? ''

  if (OPERATORS.has(key)) {
    if (!text) return text
    if (last && OPERATORS.has(last)) return text.slice(0, -1) + key
    if (last === '.') return text.slice(0, -1) + key
    return text + key
  }
  if (key === '.') {
    if (segment.includes('.')) return text
    return text + (segment === '' ? '0.' : '.')
  }
  // 数字
  if (/\.\d{2}$/.test(segment)) return text
  if (segment === '0') return text.slice(0, -1) + key
  return text + key
}

/** 把键盘输入的字符映射为键位，非金额字符返回 null */
export function keyFromKeyboard(key: string): KeypadKey | null {
  if (/^[0-9.+\-*/]$/.test(key)) return key as KeypadKey
  if (key === 'Backspace') return 'backspace'
  return null
}
