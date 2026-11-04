/** 支持的分隔符：逗号、制表符、分号 */
export type Delimiter = ',' | '\t' | ';'

const DELIMITERS: Delimiter[] = [',', '\t', ';']

/**
 * 根据前若干行猜分隔符：选在多数行里出现次数稳定且最多的那个。
 * 引号内的字符不计入。
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 40)
  let best: Delimiter = ','
  let bestScore = 0
  for (const d of DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, d))
    // 以出现次数的众数衡量，说明行通常没有分隔符，不影响结果
    const freq = new Map<number, number>()
    for (const c of counts) if (c > 0) freq.set(c, (freq.get(c) ?? 0) + 1)
    let score = 0
    for (const [count, times] of freq) score = Math.max(score, times * count)
    if (score > bestScore) {
      best = d
      bestScore = score
    }
  }
  return best
}

function countOutsideQuotes(line: string, d: string): number {
  let inQuotes = false
  let count = 0
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === d && !inQuotes) count++
  }
  return count
}

/**
 * 解析 CSV（RFC 4180）：支持引号、引号转义（""）、字段内换行和 CRLF。
 * 单元格去掉首尾空白和制表符（微信账单的金额等列带有尾随制表符），末尾的空行会被丢弃。
 */
export function parseCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += ch
    } else if (ch === '"' && cell.trim() === '') {
      cell = ''
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  const cleaned = rows.map((r) => r.map((c) => c.trim()))
  while (cleaned.length > 0 && cleaned.at(-1)!.every((c) => c === '')) cleaned.pop()
  return cleaned
}
