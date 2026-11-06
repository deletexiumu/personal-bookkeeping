import { parseCsv, type Delimiter, detectDelimiter } from './csv'
import { decodeText } from './decode'
import { isPdf, readPdfText } from './pdf'
import { pdfItemsToLines } from './pdfTable'
import { autoMap, findHeaderRow, toTable, type ColumnMapping, type ParseResult, type SheetTable } from './table'
import { detectTemplate, templateMapping, type BuiltinTemplate } from './templates'
import { isZip, readXlsx } from './xlsx'
import type { ImportTemplate } from '../../types'

/** 格式嗅探结果：文件格式与编码、表头行、表格、映射，以及命中的内置模板 */
export interface SniffResult {
  format: 'utf-8' | 'gbk' | 'xlsx' | 'pdf'
  delimiter?: Delimiter
  /** 原始行（未切表头） */
  lines: string[][]
  table: SheetTable
  mapping: ColumnMapping[]
  template?: BuiltinTemplate
  /** 命中的用户模板 */
  userTemplate?: ImportTemplate
  /** 表头前说明行里的户名（银行流水），用于识别本人账户互转 */
  holder?: string
  /** 表头前说明行里的账号 / 卡号，用于匹配本地账户 */
  accountNo?: string
}

const clean = (s: string) => s.replace(/\s/g, '')

/** 找表头与用户模板完全一致的一行 */
export function detectUserTemplate(lines: string[][], templates: ImportTemplate[]): { template: ImportTemplate; headerRow: number } | undefined {
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const headers = headerSignature(lines[i])
    const template = templates.find((t) => t.headers.length === headers.length && t.headers.every((h, j) => h === headers[j]))
    if (template) return { template, headerRow: i }
  }
  return undefined
}

/** 模板的表头签名（去掉空白和末尾空列） */
export function headerSignature(headers: string[]): string[] {
  const out = headers.map(clean)
  while (out.length > 0 && out.at(-1) === '') out.pop()
  return out
}

/** 从表头前的说明行读出户名和账号，例如「户名：张三」「账号：6214 **** 1234」 */
export function readStatementMeta(lines: string[][], headerRow: number): Pick<SniffResult, 'holder' | 'accountNo'> {
  const meta: Pick<SniffResult, 'holder' | 'accountNo'> = {}
  for (const line of lines.slice(0, headerRow)) {
    const text = line.join(' ')
    const holder = /户\s*名\s*[：:]\s*([^\s：:,，|]+)/.exec(text)?.[1]
    const accountNo = /(?:账\s*号|卡\s*号)\s*[：:]\s*(\d[\d\s*]{6,}\d)/.exec(text)?.[1]
    if (holder && !meta.holder) meta.holder = holder
    if (accountNo && !meta.accountNo) meta.accountNo = accountNo.replace(/\s/g, '')
  }
  return meta
}

/** 按模板清洗单元格 */
function cleanTable(table: SheetTable, template: BuiltinTemplate): SheetTable {
  const clean = template.clean
  if (!clean) return table
  const fns = table.headers.map((h) => clean[h.replace(/\s/g, '')])
  return { ...table, rows: table.rows.map((row) => ({ ...row, cells: row.cells.map((c, i) => (fns[i] ? fns[i](c) : c)) })) }
}

function fromLines(lines: string[][], format: SniffResult['format'], delimiter: Delimiter | undefined, templates: ImportTemplate[]): SniffResult {
  const hit = detectTemplate(lines)
  if (hit) {
    const table = cleanTable(toTable(lines, hit.headerRow), hit.template)
    return {
      format,
      delimiter,
      lines,
      table,
      mapping: templateMapping(hit.template, table.headers),
      template: hit.template,
      ...readStatementMeta(lines, hit.headerRow),
    }
  }
  const user = detectUserTemplate(lines, templates)
  if (user) {
    const table = toTable(lines, user.headerRow)
    const mapping = table.headers.map((_, i): ColumnMapping => {
      const field = user.template.columns[i] ?? 'ignore'
      return { field, status: field === 'ignore' ? 'skip' : 'matched' }
    })
    return { format, delimiter, lines, table, mapping, userTemplate: user.template, ...readStatementMeta(lines, user.headerRow) }
  }
  const table = toTable(lines, findHeaderRow(lines))
  return { format, delimiter, lines, table, mapping: autoMap(table), ...readStatementMeta(lines, table.headerRow) }
}

/** 读入文本表格文件（CSV / TSV）：检测编码与分隔符，匹配内置模板，否则找表头并自动映射 */
export function sniffText(bytes: Uint8Array, templates: ImportTemplate[] = []): SniffResult {
  const { text, encoding } = decodeText(bytes)
  const delimiter = detectDelimiter(text)
  return fromLines(parseCsv(text, delimiter), encoding, delimiter, templates)
}

/** 读入账单文件：xlsx、PDF 或 CSV / TSV */
export async function sniffFile(bytes: Uint8Array, templates: ImportTemplate[] = []): Promise<SniffResult> {
  if (isZip(bytes)) return fromLines(await readXlsx(bytes), 'xlsx', undefined, templates)
  if (isPdf(bytes)) {
    const items = await readPdfText(bytes)
    if (items.length === 0) throw new Error('PDF 里没有可读取的文字，可能是扫描件')
    return fromLines(pdfItemsToLines(items), 'pdf', undefined, templates)
  }
  return sniffText(bytes, templates)
}

/** 解析后按模板做的收尾：银行流水里对方是本人（户名相同）的标为本人账户互转，默认不入账 */
export function finishRows(sniff: SniffResult, parsed: ParseResult): ParseResult {
  const holder = sniff.holder
  if (!sniff.template?.selfTransfer || !holder) return parsed
  return {
    ...parsed,
    rows: parsed.rows.map((row) => (row.merchant === holder && !row.skipReason ? { ...row, skipReason: '本人账户互转' } : row)),
  }
}

/** 改了表头行后重新切表并自动映射（不再套用模板） */
export function withHeaderRow(result: SniffResult, headerRow: number): SniffResult {
  const table = toTable(result.lines, headerRow)
  return { ...result, table, mapping: autoMap(table), template: undefined, userTemplate: undefined }
}

/** 由文件名推荐模板名：去掉扩展名、日期和末尾的分隔符，例如「招商银行信用卡账单-2026-10.csv」→「招商银行信用卡账单」 */
export function suggestTemplateName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[\d_\-()（）\s.]+$/g, '').replace(/\d{4}[-_.年]?\d{1,2}([-_.月]?\d{1,2})?日?/g, '')
  return (base.trim() || '我的模板').slice(0, 20)
}
