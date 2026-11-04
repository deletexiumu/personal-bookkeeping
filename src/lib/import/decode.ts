export type TextEncoding = 'utf-8' | 'gbk'

export interface DecodedText {
  text: string
  encoding: TextEncoding
}

/**
 * 把账单文件的字节解码为文本：先按 UTF-8 严格解码，失败再按 GBK（支付宝、多数网银导出的 CSV 是 GBK）。
 * 去掉 UTF-8 BOM。
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text: text.replace(/^﻿/, ''), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('gbk').decode(bytes), encoding: 'gbk' }
  }
}
