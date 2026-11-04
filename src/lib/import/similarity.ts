/** 归一化文本：转小写，去掉空白和标点，用于商户比对 */
export function normalizeText(input: string | undefined): string {
  return (input ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

function bigrams(text: string): string[] {
  const chars = [...text]
  if (chars.length < 2) return chars
  return chars.slice(1).map((ch, i) => chars[i] + ch)
}

/**
 * 文本相似度（0–1）：一方包含另一方（至少两个字）视为 1，否则用二元组 Dice 系数。
 * 例：「美团外卖」与「美团外卖-订单3381」为 1。
 */
export function similarity(a: string | undefined, b: string | undefined): number {
  const x = normalizeText(a)
  const y = normalizeText(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if ([...short].length >= 2 && long.includes(short)) return 1
  const bx = bigrams(x)
  const by = bigrams(y)
  const pool = new Map<string, number>()
  for (const g of by) pool.set(g, (pool.get(g) ?? 0) + 1)
  let hits = 0
  for (const g of bx) {
    const n = pool.get(g) ?? 0
    if (n > 0) {
      hits++
      pool.set(g, n - 1)
    }
  }
  return (2 * hits) / (bx.length + by.length)
}
