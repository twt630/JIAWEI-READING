import { decodeBytes, splitText } from './text'
import type { Encoding } from '../../types'

self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; bookId: string; encoding?: Encoding }>) => {
  try {
    const { text, encoding } = decodeBytes(new Uint8Array(event.data.buffer), event.data.encoding)
    self.postMessage({ ok: true, text, encoding, chunks: splitText(text, event.data.bookId) })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : '读取文件失败' })
  }
}
