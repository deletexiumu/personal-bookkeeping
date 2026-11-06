/**
 * 极简 PDF 文本读取：取出每页文字及其位置，满足银行流水证明这类「电脑生成、文字可选中」的 PDF。
 * 和 xlsx.ts 一样不引入第三方库：用浏览器自带的 DecompressionStream 解压内容流，
 * 自己解析对象、页面树、字体的 ToUnicode 映射和内容流里的文字绘制指令。
 * 不支持加密 PDF 和扫描件（图片里的文字）。
 */

export interface PdfTextItem {
  /** 页码，从 1 开始 */
  page: number
  /** 左上角为原点、向下为正的坐标（pt） */
  x: number
  y: number
  width: number
  /** 字号（pt） */
  height: number
  str: string
}

class Name {
  readonly v: string
  constructor(v: string) {
    this.v = v
  }
}
class Ref {
  readonly num: number
  constructor(num: number) {
    this.num = num
  }
}
/** 字符串的原始字节（每个字符一个字节） */
class Str {
  readonly v: string
  constructor(v: string) {
    this.v = v
  }
}
/** 内容流里的操作符 */
class Op {
  readonly v: string
  constructor(v: string) {
    this.v = v
  }
}
interface Stream {
  dict: Dict
  start: number
  /** 数据长度；未知时为 -1，读取时找 endstream */
  length: number
}
type Dict = { [key: string]: Value }
type Value = number | boolean | null | Name | Ref | Str | Value[] | Dict | Stream

const isDict = (v: Value | undefined): v is Dict =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Name) && !(v instanceof Ref) && !(v instanceof Str) && !('start' in v && 'dict' in v)
const isStream = (v: Value | undefined): v is Stream => typeof v === 'object' && v !== null && 'start' in v && 'dict' in v
const nameOf = (v: Value | undefined) => (v instanceof Name ? v.v : undefined)
const num = (v: Value | undefined, fallback = 0) => (typeof v === 'number' ? v : fallback)

/** 字节转「二进制字符串」：每个字符对应一个字节 */
function binaryString(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return out
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])
const DELIMITERS = new Set([...'()<>[]{}/%'].map((c) => c.charCodeAt(0)))

/** PDF 词法 / 语法解析器，也用于内容流 */
class Parser {
  readonly s: string
  pos: number
  constructor(s: string, pos = 0) {
    this.s = s
    this.pos = pos
  }

  skipSpace() {
    const s = this.s
    while (this.pos < s.length) {
      const c = s.charCodeAt(this.pos)
      if (WHITESPACE.has(c)) this.pos++
      else if (c === 0x25) {
        // % 注释到行尾
        while (this.pos < s.length && s[this.pos] !== '\n' && s[this.pos] !== '\r') this.pos++
      } else break
    }
  }

  private regular(): string {
    const start = this.pos
    while (this.pos < this.s.length) {
      const c = this.s.charCodeAt(this.pos)
      if (WHITESPACE.has(c) || DELIMITERS.has(c)) break
      this.pos++
    }
    return this.s.slice(start, this.pos)
  }

  private literal(): Str {
    const s = this.s
    let depth = 1
    let out = ''
    this.pos++
    while (this.pos < s.length) {
      const ch = s[this.pos++]
      if (ch === '\\') {
        const e = s[this.pos++]
        const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }
        if (e in map) out += map[e]
        else if (e >= '0' && e <= '7') {
          let oct = e
          while (oct.length < 3 && s[this.pos] >= '0' && s[this.pos] <= '7') oct += s[this.pos++]
          out += String.fromCharCode(parseInt(oct, 8) & 0xff)
        } else if (e === '\r') {
          if (s[this.pos] === '\n') this.pos++
        } else if (e !== '\n') out += e
      } else if (ch === '(') {
        depth++
        out += ch
      } else if (ch === ')') {
        if (--depth === 0) break
        out += ch
      } else out += ch
    }
    return new Str(out)
  }

  private hex(): Str {
    const end = this.s.indexOf('>', this.pos)
    const digits = this.s.slice(this.pos + 1, end < 0 ? undefined : end).replace(/[^0-9a-fA-F]/g, '')
    this.pos = end < 0 ? this.s.length : end + 1
    let out = ''
    for (let i = 0; i < digits.length; i += 2) out += String.fromCharCode(parseInt(digits.slice(i, i + 2).padEnd(2, '0'), 16))
    return new Str(out)
  }

  /** 读一个值；遇到操作符返回 Op，读到结尾返回 undefined */
  value(): Value | Op | undefined {
    this.skipSpace()
    const s = this.s
    if (this.pos >= s.length) return undefined
    const ch = s[this.pos]
    if (ch === '/') {
      this.pos++
      return new Name(this.regular().replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))))
    }
    if (ch === '(') return this.literal()
    if (ch === '<') {
      if (s[this.pos + 1] !== '<') return this.hex()
      this.pos += 2
      const dict: Dict = {}
      for (;;) {
        this.skipSpace()
        if (this.pos >= s.length) break
        if (s.startsWith('>>', this.pos)) {
          this.pos += 2
          break
        }
        const key = this.value()
        if (!(key instanceof Name)) continue
        const v = this.value()
        if (v !== undefined && !(v instanceof Op)) dict[key.v] = v
      }
      return dict
    }
    if (ch === '[') {
      this.pos++
      const arr: Value[] = []
      for (;;) {
        this.skipSpace()
        if (this.pos >= s.length) break
        if (s[this.pos] === ']') {
          this.pos++
          break
        }
        const v = this.value()
        if (v === undefined) break
        if (!(v instanceof Op)) arr.push(v)
      }
      return arr
    }
    if (ch === '>' || ch === ']' || ch === ')' || ch === '{' || ch === '}') {
      this.pos++
      return this.value()
    }
    const word = this.regular()
    if (word === '') {
      this.pos++
      return this.value()
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      const n = Number(word)
      // 「12 0 R」是间接引用
      if (/^\d+$/.test(word)) {
        const m = /^\s+(\d+)\s+R(?![^\s()<>[\]{}/%])/.exec(s.slice(this.pos, this.pos + 24))
        if (m) {
          this.pos += m[0].length
          return new Ref(n)
        }
      }
      return n
    }
    if (word === 'true') return true
    if (word === 'false') return false
    if (word === 'null') return null
    return new Op(word)
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const copy = data.slice() as Uint8Array<ArrayBuffer>
  for (const format of ['deflate', 'deflate-raw'] as const) {
    try {
      const stream = new ReadableStream<BufferSource>({
        start(c) {
          c.enqueue(copy)
          c.close()
        },
      }).pipeThrough(new DecompressionStream(format))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    } catch {
      // zlib 头不对时退回 raw deflate
    }
  }
  throw new Error('PDF 数据流解压失败')
}

/** 已解码的单个字体：编码 → Unicode、宽度 */
interface Font {
  twoByte: boolean
  /** 码值直接就是 UCS-2（UniGB-UCS2-H 等预定义编码） */
  ucs2: boolean
  toUnicode: Map<number, string>
  widths: Map<number, number>
  defaultWidth: number
  /** 去掉子集前缀的字体名，用于同族字体互相补全映射 */
  family: string
  /** 单字节字体的 Differences 编码 */
  differences: Map<number, string>
}

/** 解析 ToUnicode CMap：bfchar / bfrange */
export function parseToUnicode(text: string): Map<number, string> {
  const map = new Map<number, string>()
  const utf16 = (hex: string) => {
    let out = ''
    for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
    if (hex.length === 2) out = String.fromCharCode(parseInt(hex, 16))
    return out
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), utf16(m[2]))
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16)
      const hi = Math.min(parseInt(m[2], 16), lo + 0xffff)
      if (m[3].startsWith('[')) {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1])
        items.forEach((hex, i) => lo + i <= hi && map.set(lo + i, utf16(hex)))
      } else {
        const hex = m[3].slice(1, -1)
        const base = utf16(hex)
        for (let c = lo; c <= hi; c++) {
          // 末位字符递增
          map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo)))
        }
      }
    }
  }
  return map
}

/** 码值所在的字符区块；只在这些区块里推断缺失的映射 */
function blockOf(u: number): string | undefined {
  if (u >= 0x4e00 && u <= 0x9fff) return 'cjk'
  if (u >= 0x3400 && u <= 0x4dbf) return 'cjk-a'
  if (u >= 0xff00 && u <= 0xffef) return 'fullwidth'
  if (u >= 0x3000 && u <= 0x303f) return 'cjk-punct'
  return undefined
}

/**
 * 同族字体的「码值 → 字符」合集，用来推断 ToUnicode 漏掉的字。
 * 有的网银 PDF（如招商银行流水）ToUnicode 漏掉了一部分汉字，但码值就是原字体的字形编号，
 * 与 Unicode 分段线性对应：用最近的已知码值的偏移量推断，结果须与邻居在同一字符区块。
 */
class FamilyMap {
  private readonly known = new Map<string, Map<number, number>>()
  private sorted = new Map<string, number[]>()

  add(font: Font) {
    if (!font.twoByte || font.ucs2) return
    let m = this.known.get(font.family)
    if (!m) this.known.set(font.family, (m = new Map()))
    for (const [code, str] of font.toUnicode) if (str.length === 1 && blockOf(str.charCodeAt(0))) m.set(code, str.charCodeAt(0))
    this.sorted.delete(font.family)
  }

  infer(family: string, code: number): string | undefined {
    const m = this.known.get(family)
    if (!m || m.size === 0) return undefined
    let keys = this.sorted.get(family)
    if (!keys) this.sorted.set(family, (keys = [...m.keys()].sort((a, b) => a - b)))
    let lo = 0
    let hi = keys.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (keys[mid] < code) lo = mid + 1
      else hi = mid
    }
    const candidates = [keys[lo - 1], keys[lo]].filter((k): k is number => k !== undefined)
    candidates.sort((a, b) => Math.abs(a - code) - Math.abs(b - code))
    for (const k of candidates) {
      const u = m.get(k)!
      const guess = code + (u - k)
      if (blockOf(guess) && blockOf(guess) === blockOf(u)) return String.fromCharCode(guess)
    }
    return undefined
  }
}

/** 常见字形名（单字节字体的 Differences） */
const GLYPH_NAMES: Record<string, string> = {
  space: ' ',
  period: '.',
  comma: ',',
  colon: ':',
  hyphen: '-',
  minus: '-',
  slash: '/',
  parenleft: '(',
  parenright: ')',
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
}

function glyphNameToUnicode(name: string): string | undefined {
  if (name in GLYPH_NAMES) return GLYPH_NAMES[name]
  if (/^[A-Za-z]$/.test(name)) return name
  const uni = /^uni([0-9A-Fa-f]{4})$/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name)
  if (uni) return String.fromCodePoint(parseInt(uni[1], 16))
  return undefined
}

class PdfDocument {
  private readonly s: string
  private readonly offsets = new Map<number, number>()
  private readonly objStmEntries = new Map<number, { stream: number; index: number }>()
  private readonly cache = new Map<number, Value>()
  private readonly objStmCache = new Map<number, Promise<Value[]>>()
  private readonly fonts = new Map<Value, Promise<Font>>()
  readonly family = new FamilyMap()
  readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.s = binaryString(bytes)
    // 扫描全部「n g obj」，后出现的（增量更新）覆盖前面的
    for (const m of this.s.matchAll(/(?<![0-9])(\d+)\s+(\d+)\s+obj\b/g)) this.offsets.set(Number(m[1]), m.index + m[0].length)
  }

  get(v: Value | undefined): Value | undefined {
    let cur = v
    for (let i = 0; cur instanceof Ref && i < 32; i++) cur = this.object(cur.num)
    return cur instanceof Ref ? undefined : cur
  }

  private object(n: number): Value | undefined {
    if (this.cache.has(n)) return this.cache.get(n)
    const at = this.offsets.get(n)
    if (at === undefined) return undefined
    const p = new Parser(this.s, at)
    let v = p.value()
    if (v instanceof Op || v === undefined) v = null
    if (isDict(v)) {
      p.skipSpace()
      if (this.s.startsWith('stream', p.pos)) {
        let start = p.pos + 6
        if (this.s[start] === '\r') start++
        if (this.s[start] === '\n') start++
        const len = v.Length
        v = { dict: v, start, length: typeof len === 'number' ? len : -1 }
      }
    }
    this.cache.set(n, v)
    return v
  }

  async streamData(stream: Stream): Promise<Uint8Array> {
    let length = stream.length
    if (length < 0) length = num(this.get(stream.dict.Length), -1)
    if (length < 0 || stream.start + length > this.bytes.length || !/^\s*endstream/.test(this.s.slice(stream.start + length, stream.start + length + 20))) {
      const end = this.s.indexOf('endstream', stream.start)
      length = (end < 0 ? this.bytes.length : end) - stream.start
    }
    let data: Uint8Array = this.bytes.subarray(stream.start, stream.start + length)
    const filter = this.get(stream.dict.Filter)
    const filters = (Array.isArray(filter) ? filter : filter ? [filter] : []).map((f) => nameOf(this.get(f)))
    for (const f of filters) {
      if (f === 'FlateDecode' || f === 'Fl') data = await inflate(data)
      else if (f === 'ASCIIHexDecode' || f === 'AHx') {
        const hex = binaryString(data).replace(/[^0-9a-fA-F]/g, '')
        data = Uint8Array.from({ length: hex.length >> 1 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))
      } else throw new Error(`不支持的 PDF 压缩方式：${f}`)
    }
    return data
  }

  /** 读入对象流（PDF 1.5 起可把对象压缩存放），登记其中的对象 */
  async loadObjectStreams() {
    for (const n of [...this.offsets.keys()]) {
      const v = this.object(n)
      if (!isStream(v) || nameOf(v.dict.Type) !== 'ObjStm') continue
      const count = num(v.dict.N)
      const head = new Parser(binaryString(await this.streamData(v)))
      for (let i = 0; i < count; i++) {
        const objNum = head.value()
        head.value()
        if (typeof objNum === 'number' && !this.offsets.has(objNum)) this.objStmEntries.set(objNum, { stream: n, index: i })
      }
    }
    for (const [objNum, { stream, index }] of this.objStmEntries) {
      const values = await this.objectStream(stream)
      this.cache.set(objNum, values[index] ?? null)
    }
  }

  private objectStream(n: number): Promise<Value[]> {
    let p = this.objStmCache.get(n)
    if (!p) {
      p = (async () => {
        const v = this.object(n) as Stream
        const text = binaryString(await this.streamData(v))
        const count = num(v.dict.N)
        const first = num(v.dict.First)
        const head = new Parser(text)
        const offsets: number[] = []
        for (let i = 0; i < count; i++) {
          head.value()
          offsets.push(num(head.value() as Value))
        }
        return offsets.map((off) => {
          const val = new Parser(text, first + off).value()
          return val instanceof Op || val === undefined ? null : val
        })
      })()
      this.objStmCache.set(n, p)
    }
    return p
  }

  isEncrypted(): boolean {
    return this.trailerDicts().some((d) => d.Encrypt !== undefined)
  }

  private trailerDicts(): Dict[] {
    const out: Dict[] = []
    for (const m of this.s.matchAll(/trailer\s*<</g)) {
      const v = new Parser(this.s, m.index + m[0].length - 2).value()
      if (isDict(v)) out.push(v)
    }
    for (const n of this.offsets.keys()) {
      const v = this.object(n)
      if (isStream(v) && nameOf(v.dict.Type) === 'XRef') out.push(v.dict)
    }
    return out
  }

  catalog(): Dict | undefined {
    for (const d of this.trailerDicts().reverse()) {
      const root = this.get(d.Root)
      if (isDict(root)) return root
    }
    for (const n of [...this.offsets.keys(), ...this.objStmEntries.keys()]) {
      const v = this.get(new Ref(n))
      if (isDict(v) && nameOf(v.Type) === 'Catalog') return v
    }
    return undefined
  }

  /** 按页面树顺序列出页面，继承 Resources 和 MediaBox */
  pages(): { dict: Dict; resources: Dict; mediaBox: number[] }[] {
    const out: { dict: Dict; resources: Dict; mediaBox: number[] }[] = []
    const seen = new Set<Value>()
    const walk = (node: Value | undefined, resources: Dict, mediaBox: number[]) => {
      const d = this.get(node)
      if (!isDict(d) || seen.has(d)) return
      seen.add(d)
      const res = this.get(d.Resources)
      const box = this.get(d.MediaBox)
      const nextRes = isDict(res) ? res : resources
      const nextBox = Array.isArray(box) && box.length === 4 ? box.map((b) => num(this.get(b))) : mediaBox
      const kids = this.get(d.Kids)
      if (Array.isArray(kids)) kids.forEach((k) => walk(k, nextRes, nextBox))
      else if (nameOf(d.Type) === 'Page' || d.Contents !== undefined) out.push({ dict: d, resources: nextRes, mediaBox: nextBox })
    }
    walk(this.catalog()?.Pages, {}, [0, 0, 595, 842])
    return out
  }

  font(ref: Value): Promise<Font> {
    const key = ref instanceof Ref ? ref.num : ref
    let p = this.fonts.get(key)
    if (!p) {
      p = this.loadFont(ref)
      this.fonts.set(key, p)
    }
    return p
  }

  private async loadFont(ref: Value): Promise<Font> {
    const d = this.get(ref)
    const dict = isDict(d) ? d : {}
    const subtype = nameOf(dict.Subtype)
    const encoding = this.get(dict.Encoding)
    const encName = nameOf(encoding) ?? ''
    const font: Font = {
      twoByte: subtype === 'Type0',
      ucs2: /UCS2|UTF16/.test(encName),
      toUnicode: new Map(),
      widths: new Map(),
      defaultWidth: subtype === 'Type0' ? 1000 : 500,
      family: (nameOf(dict.BaseFont) ?? '').replace(/^[A-Z]{6}\+/, '').replace(/[-,](Identity-H|Bold|Regular).*$/i, ''),
      differences: new Map(),
    }
    const tu = this.get(dict.ToUnicode)
    if (isStream(tu)) {
      try {
        font.toUnicode = parseToUnicode(binaryString(await this.streamData(tu)))
      } catch {
        // 映射损坏时按无映射处理
      }
    }
    if (font.twoByte) {
      const descendants = this.get(dict.DescendantFonts)
      const cid = this.get(Array.isArray(descendants) ? descendants[0] : undefined)
      if (isDict(cid)) {
        font.defaultWidth = num(this.get(cid.DW), 1000)
        const w = this.get(cid.W)
        if (Array.isArray(w)) {
          for (let i = 0; i < w.length; ) {
            const first = num(this.get(w[i]))
            const next = this.get(w[i + 1])
            if (Array.isArray(next)) {
              next.forEach((x, j) => font.widths.set(first + j, num(this.get(x))))
              i += 2
            } else {
              const last = num(next)
              const width = num(this.get(w[i + 2]))
              for (let c = first; c <= last && c - first < 0x10000; c++) font.widths.set(c, width)
              i += 3
            }
          }
        }
      }
    } else {
      const firstChar = num(this.get(dict.FirstChar))
      const widths = this.get(dict.Widths)
      if (Array.isArray(widths)) widths.forEach((x, i) => font.widths.set(firstChar + i, num(this.get(x))))
      if (isDict(encoding)) {
        const diffs = this.get(encoding.Differences)
        if (Array.isArray(diffs)) {
          let code = 0
          for (const item of diffs) {
            const v = this.get(item)
            if (typeof v === 'number') code = v
            else if (v instanceof Name) font.differences.set(code++, v.v)
          }
        }
      }
    }
    this.family.add(font)
    return font
  }
}

type Matrix = [number, number, number, number, number, number]

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
]

interface GState {
  ctm: Matrix
  font?: Font
  fontSize: number
  charSpacing: number
  wordSpacing: number
  hScale: number
  leading: number
  rise: number
}

function decodeChar(font: Font, code: number, family: FamilyMap): string {
  const mapped = font.toUnicode.get(code)
  if (mapped !== undefined) return mapped
  if (font.ucs2) return String.fromCharCode(code)
  if (font.twoByte) return family.infer(font.family, code) ?? '□'
  const name = font.differences.get(code)
  const fromName = name ? glyphNameToUnicode(name) : undefined
  if (fromName) return fromName
  return String.fromCharCode(code)
}

/** 解释一页（或表单 XObject）的内容流，收集文字 */
async function runContent(doc: PdfDocument, content: string, resources: Dict, base: GState, emit: (str: string, x: number, y: number, width: number, size: number) => void, depth = 0) {
  const fontsDict = doc.get(resources.Font)
  const xobjects = doc.get(resources.XObject)
  const parser = new Parser(content)
  const stack: (Value | Op)[] = []
  const states: GState[] = []
  let gs: GState = { ...base }
  let tm: Matrix = [1, 0, 0, 1, 0, 0]
  let tlm: Matrix = [1, 0, 0, 1, 0, 0]

  const nums = (n: number) => stack.slice(-n).map((v) => (typeof v === 'number' ? v : 0))
  const moveText = (tx: number, ty: number) => {
    tlm = multiply([1, 0, 0, 1, tx, ty], tlm)
    tm = tlm
  }

  const show = (parts: (Str | number)[]) => {
    const font = gs.font
    if (!font) return
    const trm = multiply(tm, gs.ctm)
    const start = multiply([gs.fontSize * (gs.hScale / 100), 0, 0, gs.fontSize, 0, gs.rise], trm)
    let text = ''
    let advance = 0
    for (const part of parts) {
      if (typeof part === 'number') {
        const shift = (-part / 1000) * gs.fontSize * (gs.hScale / 100)
        advance += shift
        // 明显的间隔（超过四分之一个字宽）补一个空格
        if (part < -250 && text !== '' && !text.endsWith(' ')) text += ' '
        continue
      }
      const bytes = part.v
      const step = font.twoByte ? 2 : 1
      for (let i = 0; i + step <= bytes.length; i += step) {
        const code = step === 2 ? (bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1) : bytes.charCodeAt(i)
        text += decodeChar(font, code, doc.family)
        const w = font.widths.get(code) ?? font.defaultWidth
        const space = step === 1 && code === 32 ? gs.wordSpacing : 0
        advance += ((w / 1000) * gs.fontSize + gs.charSpacing + space) * (gs.hScale / 100)
      }
    }
    tm = multiply([1, 0, 0, 1, advance, 0], tm)
    const scaleX = Math.hypot(trm[0], trm[1]) || 1
    const size = Math.abs(start[3]) || Math.abs(start[1]) || gs.fontSize
    if (text.trim() !== '') emit(text, start[4], start[5], advance * scaleX, size)
  }

  for (;;) {
    const v = parser.value()
    if (v === undefined) break
    if (!(v instanceof Op)) {
      stack.push(v)
      continue
    }
    switch (v.v) {
      case 'q':
        states.push({ ...gs })
        break
      case 'Q':
        gs = states.pop() ?? gs
        break
      case 'cm':
        gs.ctm = multiply(nums(6) as Matrix, gs.ctm)
        break
      case 'BT':
        tm = [1, 0, 0, 1, 0, 0]
        tlm = tm
        break
      case 'Tf': {
        const [name, size] = stack.slice(-2)
        const ref = isDict(fontsDict) && name instanceof Name ? fontsDict[name.v] : undefined
        gs.font = ref === undefined ? undefined : await doc.font(ref)
        gs.fontSize = typeof size === 'number' ? size : gs.fontSize
        break
      }
      case 'Tc':
        gs.charSpacing = nums(1)[0]
        break
      case 'Tw':
        gs.wordSpacing = nums(1)[0]
        break
      case 'Tz':
        gs.hScale = nums(1)[0]
        break
      case 'TL':
        gs.leading = nums(1)[0]
        break
      case 'Ts':
        gs.rise = nums(1)[0]
        break
      case 'Td': {
        const [tx, ty] = nums(2)
        moveText(tx, ty)
        break
      }
      case 'TD': {
        const [tx, ty] = nums(2)
        gs.leading = -ty
        moveText(tx, ty)
        break
      }
      case 'Tm':
        tlm = nums(6) as Matrix
        tm = tlm
        break
      case 'T*':
        moveText(0, -gs.leading)
        break
      case 'Tj': {
        const s = stack.at(-1)
        if (s instanceof Str) show([s])
        break
      }
      case "'": {
        moveText(0, -gs.leading)
        const s = stack.at(-1)
        if (s instanceof Str) show([s])
        break
      }
      case '"': {
        const [aw, ac] = nums(3)
        gs.wordSpacing = aw
        gs.charSpacing = ac
        moveText(0, -gs.leading)
        const s = stack.at(-1)
        if (s instanceof Str) show([s])
        break
      }
      case 'TJ': {
        const arr = stack.at(-1)
        if (Array.isArray(arr)) show(arr.filter((x): x is Str | number => x instanceof Str || typeof x === 'number'))
        break
      }
      case 'Do': {
        const name = stack.at(-1)
        const xo = isDict(xobjects) && name instanceof Name ? doc.get(xobjects[name.v]) : undefined
        if (depth < 8 && isStream(xo) && nameOf(xo.dict.Subtype) === 'Form') {
          const matrix = doc.get(xo.dict.Matrix)
          const m = Array.isArray(matrix) && matrix.length === 6 ? (matrix.map((x) => num(doc.get(x))) as Matrix) : ([1, 0, 0, 1, 0, 0] as Matrix)
          const res = doc.get(xo.dict.Resources)
          try {
            const data = binaryString(await doc.streamData(xo))
            await runContent(doc, data, isDict(res) ? res : resources, { ...gs, ctm: multiply(m, gs.ctm) }, emit, depth + 1)
          } catch {
            // 读不了的表单跳过
          }
        }
        break
      }
      case 'BI': {
        // 内嵌图片：跳到 EI
        const end = content.indexOf('EI', parser.pos)
        parser.pos = end < 0 ? content.length : end + 2
        break
      }
    }
    stack.length = 0
  }
}

/** 是否像 PDF（文件头 %PDF-） */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
}

/** 读出 PDF 每页的文字片段及位置 */
export async function readPdfText(bytes: Uint8Array): Promise<PdfTextItem[]> {
  const doc = new PdfDocument(bytes)
  await doc.loadObjectStreams()
  if (doc.isEncrypted()) throw new Error('PDF 已加密，请先去掉密码再导入')
  const pages = doc.pages()
  if (pages.length === 0) throw new Error('PDF 里没有页面')
  // 先读入全部字体，同族字体才能互相补全漏掉的映射
  for (const page of pages) {
    const fonts = doc.get(page.resources.Font)
    if (isDict(fonts)) for (const ref of Object.values(fonts)) await doc.font(ref)
  }
  const items: PdfTextItem[] = []
  for (const [index, page] of pages.entries()) {
    const contents = doc.get(page.dict.Contents)
    const parts = (Array.isArray(contents) ? contents : [contents]).map((c) => doc.get(c)).filter(isStream)
    let content = ''
    for (const part of parts) content += binaryString(await doc.streamData(part)) + '\n'
    const top = page.mediaBox[3]
    const base: GState = { ctm: [1, 0, 0, 1, 0, 0], fontSize: 12, charSpacing: 0, wordSpacing: 0, hScale: 100, leading: 0, rise: 0 }
    await runContent(doc, content, page.resources, base, (str, x, y, width, size) => {
      items.push({ page: index + 1, x: x - page.mediaBox[0], y: top - y, width, height: size, str })
    })
  }
  return items
}
