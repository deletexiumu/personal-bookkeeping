import { parseCsv, type Delimiter, detectDelimiter } from './csv'
import { decodeText, type TextEncoding } from './decode'
import { autoMap, findHeaderRow, toTable, type ColumnMapping, type SheetTable } from './table'

/** 格式嗅探结果：编码、分隔符、表头行、表格和自动映射 */
export interface SniffResult {
  encoding: TextEncoding
  delimiter: Delimiter
  /** 原始行（未切表头） */
  lines: string[][]
  table: SheetTable
  mapping: ColumnMapping[]
}

/** 读入文本表格文件（CSV / TSV）：检测编码与分隔符，找表头，自动映射 */
export function sniffText(bytes: Uint8Array): SniffResult {
  const { text, encoding } = decodeText(bytes)
  const delimiter = detectDelimiter(text)
  const lines = parseCsv(text, delimiter)
  const table = toTable(lines, findHeaderRow(lines))
  return { encoding, delimiter, lines, table, mapping: autoMap(table) }
}

/** 改了表头行后重新切表并自动映射 */
export function withHeaderRow(result: SniffResult, headerRow: number): SniffResult {
  const table = toTable(result.lines, headerRow)
  return { ...result, table, mapping: autoMap(table) }
}
