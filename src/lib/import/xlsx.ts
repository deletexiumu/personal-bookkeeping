/**
 * 极简 xlsx 读取：只取第一个工作表的单元格文本，满足微信账单等导出文件。
 * 用浏览器自带的 DecompressionStream 解压 ZIP，DOMParser 解析 XML，不引入第三方库。
 */

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

interface ZipEntry {
  method: number
  compressedSize: number
  offset: number
}

function readEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx 文件')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const entries = new Map<string, ZipEntry>()
  const decoder = new TextDecoder()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== CENTRAL) throw new Error('xlsx 文件已损坏')
    const method = view.getUint16(p + 10, true)
    const compressedSize = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const offset = view.getUint32(p + 42, true)
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    entries.set(name, { method, compressedSize, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function streamOf(data: Uint8Array<ArrayBuffer>): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(entry.offset, true) !== LOCAL) throw new Error('xlsx 文件已损坏')
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true)
  // 复制一份，保证底层是 ArrayBuffer（DecompressionStream 不接受 SharedArrayBuffer）
  const data = bytes.slice(start, start + entry.compressedSize) as Uint8Array<ArrayBuffer>
  if (entry.method === 0) return new TextDecoder().decode(data)
  if (entry.method !== 8) throw new Error('不支持的 xlsx 压缩方式')
  return new Response(streamOf(data).pipeThrough(new DecompressionStream('deflate-raw'))).text()
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml')
}

function byTag(node: Document | Element, tag: string): Element[] {
  return [...node.getElementsByTagName(tag)]
}

/** 内置日期格式 ID（含中文区域格式） */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])

function isDateFormat(code: string): boolean {
  const stripped = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
  return /[ymdhs]/i.test(stripped) && !/^general$/i.test(stripped)
}

/** 每个样式索引是否为日期格式 */
function dateStyles(stylesXml: string | undefined): boolean[] {
  if (!stylesXml) return []
  const doc = parseXml(stylesXml)
  const custom = new Map(byTag(doc, 'numFmt').map((n) => [Number(n.getAttribute('numFmtId')), n.getAttribute('formatCode') ?? '']))
  const cellXfs = byTag(doc, 'cellXfs')[0]
  if (!cellXfs) return []
  return byTag(cellXfs, 'xf').map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') ?? 0)
    return DATE_FORMAT_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))
  })
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Excel 日期序列号 → 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm:ss'（1900 日期系统） */
export function excelSerialToText(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000)
  const d = new Date(ms)
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  if (Number.isInteger(serial)) return date
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function resolveTarget(target: string): string {
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
  return path.replace(/[^/]+\/\.\.\//g, '')
}

/** 是否像 xlsx（ZIP 文件头 PK\x03\x04） */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

/** 读取第一个工作表为二维文本数组；行号与表格一致，空行保留为空数组 */
export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const entries = readEntries(bytes)
  const text = async (name: string) => {
    const entry = entries.get(name)
    return entry ? readEntry(bytes, entry) : undefined
  }

  let sheetPath = 'xl/worksheets/sheet1.xml'
  const workbook = await text('xl/workbook.xml')
  const rels = await text('xl/_rels/workbook.xml.rels')
  if (workbook && rels) {
    const first = byTag(parseXml(workbook), 'sheet')[0]
    const rid = first?.getAttribute('r:id') ?? first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    const rel = byTag(parseXml(rels), 'Relationship').find((r) => r.getAttribute('Id') === rid)
    const target = rel?.getAttribute('Target')
    if (target) sheetPath = resolveTarget(target)
  }
  const sheetXml = await text(sheetPath)
  if (!sheetXml) throw new Error('xlsx 里没有工作表')

  const sharedXml = await text('xl/sharedStrings.xml')
  const shared = sharedXml ? byTag(parseXml(sharedXml), 'si').map((si) => byTag(si, 't').map((t) => t.textContent ?? '').join('')) : []
  const isDate = dateStyles(await text('xl/styles.xml'))

  const rows: string[][] = []
  for (const row of byTag(parseXml(sheetXml), 'row')) {
    const index = Number(row.getAttribute('r') ?? rows.length + 1) - 1
    const cells: string[] = []
    for (const c of byTag(row, 'c')) {
      const col = columnIndex(c.getAttribute('r') ?? '')
      const type = c.getAttribute('t')
      const raw = byTag(c, 'v')[0]?.textContent ?? ''
      let value: string
      if (type === 's') value = shared[Number(raw)] ?? ''
      else if (type === 'inlineStr') value = byTag(c, 't').map((t) => t.textContent ?? '').join('')
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE'
      else if (!type || type === 'n') {
        const style = Number(c.getAttribute('s') ?? -1)
        value = raw !== '' && isDate[style] ? excelSerialToText(Number(raw)) : raw
      } else value = raw
      while (cells.length < col) cells.push('')
      cells[col] = value.trim()
    }
    while (rows.length < index) rows.push([])
    rows[index] = cells
  }
  return rows
}
