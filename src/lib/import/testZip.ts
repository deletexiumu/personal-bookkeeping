/** 测试用：生成最小 ZIP（xlsx）。compress 为 true 时用 deflate，否则存储。CRC 不校验，写 0。 */
async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new ReadableStream<BufferSource>({
    start(c) {
      c.enqueue(data)
      c.close()
    },
  }).pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function makeZip(files: Record<string, string>, compress = false): Promise<Uint8Array<ArrayBuffer>> {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name)
    const raw = enc.encode(content)
    const data = compress ? await deflate(raw) : raw
    const local = new Uint8Array(30 + nameBytes.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, compress ? 8 : 0, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, compress ? 8 : 0, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, centrals.length, true)
  ev.setUint16(10, centrals.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + cdSize + 22)
  let p = 0
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p)
    p += part.length
  }
  return out
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/**
 * 由二维数组生成 xlsx：字符串走共享字符串表；形如 =日期:45961.5 的单元格写成日期格式的数字。
 */
export async function makeXlsx(rows: string[][], compress = true): Promise<Uint8Array<ArrayBuffer>> {
  const shared: string[] = []
  const col = (i: number) => String.fromCharCode(65 + i)
  const sheetRows = rows
    .map((cells, r) => {
      const cs = cells
        .map((v, c) => {
          const ref = `${col(c)}${r + 1}`
          if (v === '') return ''
          if (v.startsWith('=日期:')) return `<c r="${ref}" s="1"><v>${v.slice(4)}</v></c>`
          if (/^-?\d+(\.\d+)?$/.test(v)) return `<c r="${ref}"><v>${v}</v></c>`
          shared.push(v)
          return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`
        })
        .join('')
      return `<row r="${r + 1}">${cs}</row>`
    })
    .join('')
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
  const rns = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  return makeZip(
    {
      '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
      'xl/workbook.xml': `<?xml version="1.0"?><workbook ${ns} ${rns}><sheets><sheet name="账单" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/data.xml" Type="ws"/></Relationships>`,
      'xl/styles.xml': `<?xml version="1.0"?><styleSheet ${ns}><numFmts count="1"><numFmt numFmtId="176" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="176"/></cellXfs></styleSheet>`,
      'xl/sharedStrings.xml': `<?xml version="1.0"?><sst ${ns}>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`,
      'xl/worksheets/data.xml': `<?xml version="1.0"?><worksheet ${ns}><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
    compress,
  )
}
