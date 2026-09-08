import { describe, expect, it } from 'vitest'
import { decodeBytes, MAX_FILE_SIZE, normalizeText, splitText, validateFile } from './text'

describe('TXT processing', () => {
  it('decodes UTF-8 with BOM and normalizes line endings', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('你好\r\n世界\r下一行')])
    expect(decodeBytes(bytes)).toEqual({ text: '你好\n世界\n下一行', encoding: 'utf-8' })
  })

  it('falls back to GBK for Chinese text', () => {
    const bytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])
    expect(decodeBytes(bytes)).toEqual({ text: '你好', encoding: 'gbk' })
  })

  it('rejects empty, wrong extension, and oversized files', () => {
    expect(() => validateFile({ name: 'empty.txt', size: 0 })).toThrow('空的')
    expect(() => validateFile({ name: 'book.pdf', size: 10 })).toThrow('仅支持')
    expect(() => validateFile({ name: 'book.txt', size: MAX_FILE_SIZE + 1 })).toThrow('20 MiB')
  })

  it('preserves text when chunked and does not split surrogate pairs', () => {
    const text = normalizeText(('第一段😀内容\r\n第二段\n').repeat(300))
    const chunks = splitText(text, 'book', 83)
    expect(chunks.map(chunk => chunk.text).join('')).toBe(text)
    expect(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk.text))).toBe(true)
    expect(chunks.every((chunk, index) => chunk.start === chunks.slice(0, index).reduce((sum, item) => sum + item.text.length, 0))).toBe(true)
  })
})
