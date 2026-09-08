import type { Encoding, TextChunk } from '../../types'

export const MAX_FILE_SIZE = 20 * 1024 * 1024

export function normalizeText(text: string) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

export function decodeBytes(bytes: Uint8Array, encoding?: Encoding) {
  const candidates: Encoding[] = encoding ? [encoding] : ['utf-8', 'gbk']
  for (const candidate of candidates) {
    try {
      const text = normalizeText(new TextDecoder(candidate, { fatal: true }).decode(bytes))
      if (!text.trim()) throw new Error('文件中没有可阅读的文字')
      return { text, encoding: candidate }
    } catch (error) {
      if (encoding && error instanceof Error && error.message.includes('没有可阅读')) throw error
    }
  }
  throw new Error('无法识别文件编码，请尝试手动选择 UTF-8 或 GBK')
}

export function splitText(text: string, bookId: string, target = 2000): TextChunk[] {
  const chunks: TextChunk[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + target, text.length)
    if (end < text.length) {
      const before = text.lastIndexOf('\n', end)
      const after = text.indexOf('\n', end)
      if (before > start + target * 0.65) end = before + 1
      else if (after !== -1 && after < start + target * 1.35) end = after + 1
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1
    }
    chunks.push({ bookId, index: chunks.length, start, text: text.slice(start, end) })
    start = end
  }
  return chunks
}

export function validateFile(file: Pick<File, 'name' | 'size'>) {
  if (!/\.txt$/i.test(file.name)) throw new Error('仅支持 TXT 文件')
  if (file.size === 0) throw new Error('这个文件是空的')
  if (file.size > MAX_FILE_SIZE) throw new Error('文件超过 20 MiB 上限')
}
