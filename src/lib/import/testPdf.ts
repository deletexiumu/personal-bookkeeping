/**
 * 测试用：生成最小 PDF。字体为 Type0 / Identity-H，码值 = 字形编号，仿照常见宋体子集的编排：
 * 汉字码值 = Unicode − 0x30A2，全角符号码值 = Unicode − 0x8F2B，ASCII 码值 = Unicode − 0x1D。
 * missing 里的字不写进该字体的 ToUnicode，用来模拟网银 PDF 漏掉映射的情况。
 */

export interface PdfText {
  /** 左上角为原点的坐标（pt） */
  x: number
  y: number
  str: string
  font?: 'F1' | 'F2'
  size?: number
}

export interface PdfFontSpec {
  missing?: string
}

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842

export function cidOf(ch: string): number {
  const u = ch.charCodeAt(0)
  if (u >= 0x4e00 && u <= 0x9fff) return u - 0x30a2
  if (u >= 0xff00 && u <= 0xffef) return u - 0x8f2b
  return u - 0x1d
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')

async function deflate(text: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(text)
  const stream = new ReadableStream<BufferSource>({
    start(c) {
      c.enqueue(data)
      c.close()
    },
  }).pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function toUnicodeCMap(chars: Set<string>): string {
  const entries = [...chars].map((ch) => `<${hex4(cidOf(ch))}> <${hex4(ch.charCodeAt(0))}>`)
  return [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CMapName /Adobe-Identity-UCS def /CMapType 2 def',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    `${entries.length} beginbfchar`,
    ...entries,
    'endbfchar endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n')
}

/** 生成 PDF：每页一组文字；F1、F2 是同族（SimSun）的两个子集字体 */
export async function makePdf(pages: PdfText[][], fonts: { F1?: PdfFontSpec; F2?: PdfFontSpec } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const objects: (string | { dict: string; data: Uint8Array })[] = []
  const add = (o: string | { dict: string; data: Uint8Array }) => objects.push(o) // 返回对象号
  const used: Record<'F1' | 'F2', Set<string>> = { F1: new Set(), F2: new Set() }
  for (const page of pages) for (const t of page) for (const ch of t.str) used[t.font ?? 'F1'].add(ch)

  // 1 Catalog, 2 Pages, 之后是字体和页面
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('') // Pages 占位
  const fontRefs: Record<string, number> = {}
  for (const name of ['F1', 'F2'] as const) {
    const missing = new Set(fonts[name]?.missing ?? '')
    const mapped = new Set([...used[name], ...(name === 'F2' ? '：' : '')].filter((ch) => !missing.has(ch)))
    const cmap = await deflate(toUnicodeCMap(mapped))
    const cmapNum = add({ dict: '/Filter /FlateDecode', data: cmap })
    const widths = [...new Set([...used[name]].map(cidOf))]
      .sort((a, b) => a - b)
      .map((cid) => `${cid} [${cid < 0x1000 ? 500 : 1000}]`)
      .join(' ')
    const cidFont = add(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name === 'F1' ? 'AAAAAA' : 'BBBBBB'}+SimSun /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /W [${widths}] >>`,
    )
    fontRefs[name] = add(
      `<< /Type /Font /Subtype /Type0 /BaseFont /${name === 'F1' ? 'AAAAAA' : 'BBBBBB'}+SimSun /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${cmapNum} 0 R >>`,
    )
  }
  const pageNums: number[] = []
  for (const page of pages) {
    const ops = page
      .map((t) => {
        const hex = [...t.str].map((ch) => hex4(cidOf(ch))).join('')
        return `BT /${t.font ?? 'F1'} ${t.size ?? 10} Tf 1 0 0 1 ${t.x} ${PAGE_HEIGHT - t.y} Tm <${hex}> Tj ET`
      })
      .join('\n')
    const content = add({ dict: '/Filter /FlateDecode', data: await deflate(ops) })
    pageNums.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${content} 0 R /Resources << /Font << /F1 ${fontRefs.F1} 0 R /F2 ${fontRefs.F2} 0 R >> >> >>`,
      ),
    )
  }
  objects[1] = `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`

  const enc = new TextEncoder()
  const chunks: Uint8Array[] = [enc.encode('%PDF-1.4\n')]
  let length = chunks[0].length
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(length)
    const parts =
      typeof o === 'string'
        ? [enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`)]
        : [enc.encode(`${i + 1} 0 obj\n<< ${o.dict} /Length ${o.data.length} >>\nstream\n`), o.data, enc.encode('\nendstream\nendobj\n')]
    for (const p of parts) {
      chunks.push(p)
      length += p.length
    }
  })
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('')
  chunks.push(enc.encode(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`))
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let p = 0
  for (const c of chunks) {
    out.set(c, p)
    p += c.length
  }
  return out
}
