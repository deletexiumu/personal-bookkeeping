import { matchHeader } from './fields'
import { parseDateCell } from './normalize'
import type { PdfTextItem } from './pdf'

/** 双语表头里的英文行（如招商、中信流水表头下方的英文注释），出现在表头和第一行数据之间时丢弃 */
const ENGLISH_HEADER_WORDS = new Set(
  'transaction date currency amount balance type counter party account receivable paid description recipient name no number time summary remark memo debit credit opposite payee payer'.split(' '),
)

const isEnglishHeader = (str: string) => {
  const words = str.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  return words.length > 0 && /^[A-Za-z\s.:/()-]+$/.test(str) && words.every((w) => ENGLISH_HEADER_WORDS.has(w))
}

const center = (item: PdfTextItem) => item.x + item.width / 2

/** 把同一页上纵坐标相近（相差不到半个字高）的片段归为一行，行内按横坐标排序 */
function groupLines(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
  const lines: PdfTextItem[][] = []
  for (const item of sorted) {
    const last = lines.at(-1)
    if (last && last[0].page === item.page && Math.abs(last[0].y - item.y) <= Math.max(2, item.height * 0.4)) last.push(item)
    else lines.push([item])
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x)
  return lines
}

/** 两段文字拼接：汉字之间直接相连（同一格里折行的公司名），否则加空格 */
function joinText(parts: string[]): string {
  let out = ''
  for (const raw of parts) {
    const part = raw.trim()
    if (!part) continue
    if (out && !(/[　-鿿＀-￯]$/.test(out) && /^[　-鿿＀-￯]/.test(part))) out += ' '
    out += part
  }
  return out
}

/** 表头行：至少 3 个片段能认出字段，并且命中最多 */
function findHeaderLine(lines: PdfTextItem[][]): number {
  let best = -1
  let bestScore = 2
  lines.forEach((line, i) => {
    const score = line.filter((item) => matchHeader(item.str) !== undefined).length
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  })
  return best
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b)
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]
}

/**
 * 把 PDF 文字片段还原成表格（二维文本），交给与 CSV / xlsx 相同的表头识别和映射流程。
 *
 * 做法：找出表头行，以表头各列的中心为列位置；每页里落在第一列、能解析成日期的片段是一行数据的「锚点」，
 * 其余片段归到纵向最近的锚点、横向最近的列（同一格里折成多行的文字会拼起来）。
 * 离所有锚点都远的片段（页眉、页脚、页码、声明）丢弃。表头之前的说明行原样保留，便于读出户名、账号。
 * 找不到表头时退回按行输出，每个片段一格。
 */
export function pdfItemsToLines(items: PdfTextItem[]): string[][] {
  const lines = groupLines(items)
  const headerIndex = findHeaderLine(lines)
  if (headerIndex < 0) return lines.map((line) => line.map((item) => item.str.trim()))

  const header = lines[headerIndex]
  const columns = header.map(center)
  const columnOf = (item: PdfTextItem) => {
    const c = center(item)
    let best = 0
    columns.forEach((x, i) => {
      if (Math.abs(x - c) < Math.abs(columns[best] - c)) best = i
    })
    return best
  }
  const headerTexts = header.map((item) => item.str.replace(/\s/g, ''))
  const dateColumn = Math.max(
    0,
    header.findIndex((item) => matchHeader(item.str) === 'date' || matchHeader(item.str) === 'time'),
  )

  const out: string[][] = lines.slice(0, headerIndex).map((line) => line.map((item) => item.str.trim()))
  out.push(headerTexts)

  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b)
  const headerPage = header[0].page
  for (const page of pages) {
    if (page < headerPage) continue
    const pageLines = lines.filter((line) => line[0].page === page)
    // 本页的表头（每页重复的表头）及其上方内容都不要
    const repeated = pageLines.findIndex((line) => {
      const texts = line.map((item) => item.str.replace(/\s/g, ''))
      return texts.filter((t) => headerTexts.includes(t)).length >= Math.min(3, headerTexts.length)
    })
    let body = repeated >= 0 ? pageLines.slice(repeated + 1) : pageLines
    // 紧跟表头的英文注释行
    if (repeated >= 0) {
      let skip = 0
      while (skip < body.length && body[skip].every((item) => isEnglishHeader(item.str))) skip++
      body = body.slice(skip)
    }
    const anchors = body.flatMap((line) =>
      line.filter((item) => columnOf(item) === dateColumn && parseDateCell(item.str.trim()) !== null).slice(0, 1),
    )
    if (anchors.length === 0) continue
    const anchorYs = anchors.map((a) => a.y)
    const gaps = anchorYs.slice(1).map((y, i) => y - anchorYs[i])
    const lineHeight = median(anchors.map((a) => a.height))
    const maxDistance = Math.max(lineHeight * 1.6, Math.min(median(gaps) * 0.8, lineHeight * 3))
    const cells: string[][][] = anchors.map(() => columns.map(() => []))
    for (const line of body) {
      for (const item of line) {
        let nearest = 0
        anchorYs.forEach((y, i) => {
          if (Math.abs(y - item.y) < Math.abs(anchorYs[nearest] - item.y)) nearest = i
        })
        if (Math.abs(anchorYs[nearest] - item.y) > maxDistance) continue
        cells[nearest][columnOf(item)].push(item.str)
      }
    }
    for (const row of cells) out.push(row.map(joinText))
  }
  return out
}
