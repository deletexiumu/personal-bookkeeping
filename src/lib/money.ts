/**
 * 把用户输入的金额（元）解析为分。
 * 最多两位小数，必须大于 0；不合法时返回 null。
 */
export function parseAmountToCents(input: string): number | null {
  const text = input.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  const [yuan, fen = ''] = text.split('.')
  const cents = Number(yuan) * 100 + Number(fen.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents <= 0) return null
  return cents
}

/** 把分格式化为带两位小数的人民币字符串，例如 123456 -> "¥1,234.56" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const yuan = Math.floor(abs / 100).toLocaleString('zh-CN')
  const fen = String(abs % 100).padStart(2, '0')
  return `${sign}¥${yuan}.${fen}`
}
