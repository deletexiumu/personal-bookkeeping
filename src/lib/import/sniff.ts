import { parseCsv, type Delimiter, detectDelimiter } from './csv'
import { decodeText } from './decode'
import { autoMap, findHeaderRow, toTable, type ColumnMapping, type SheetTable } from './table'
import { detectTemplate, templateMapping, type BuiltinTemplate } from './templates'
import { isZip, readXlsx } from './xlsx'

/** 格式嗅探结果：文件格式与编码、表头行、表格、映射，以及命中的内置模板 */
export interface SniffResult {
  format: 'utf-8' | 'gbk' | 'xlsx'
  delimiter?: Delimiter
  /** 原始行（未切表头） */
  lines: string[][]
  table: SheetTable
  mapping: ColumnMapping[]
  template?: BuiltinTemplate
}

function fromLines(lines: string[][], format: SniffResult['format'], delimiter?: Delimiter): SniffResult {
  const hit = detectTemplate(lines)
  if (hit) {
    const table = toTable(lines, hit.headerRow)
    return { format, delimiter, lines, table, mapping: templateMapping(hit.template, table.headers), template: hit.template }
  }
  const table = toTable(lines, findHeaderRow(lines))
  return { format, delimiter, lines, table, mapping: autoMap(table) }
}

/** 读入文本表格文件（CSV / TSV）：检测编码与分隔符，匹配内置模板，否则找表头并自动映射 */
export function sniffText(bytes: Uint8Array): SniffResult {
  const { text, encoding } = decodeText(bytes)
  const delimiter = detectDelimiter(text)
  return fromLines(parseCsv(text, delimiter), encoding, delimiter)
}

/** 读入账单文件：xlsx 或 CSV / TSV */
export async function sniffFile(bytes: Uint8Array): Promise<SniffResult> {
  if (isZip(bytes)) return fromLines(await readXlsx(bytes), 'xlsx')
  return sniffText(bytes)
}

/** 改了表头行后重新切表并自动映射（不再套用模板） */
export function withHeaderRow(result: SniffResult, headerRow: number): SniffResult {
  const table = toTable(result.lines, headerRow)
  return { ...result, table, mapping: autoMap(table), template: undefined }
}
