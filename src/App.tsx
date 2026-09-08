import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useVirtualizer } from '@tanstack/react-virtual'
import { db, getSettings, removeBook, saveBook, saveSettings } from './storage/db'
import { validateFile } from './features/import/text'
import type { Book, Encoding, ReaderSettings, TextChunk } from './types'
import { defaultSettings } from './types'

type Notice = { kind: 'error' | 'success'; text: string } | null
type Parsed = { id: string; encoding: Encoding; text: string; chunks: TextChunk[] }

function useRoute() {
  const read = () => decodeURIComponent(location.hash.match(/^#\/read\/(.+)$/)?.[1] ?? '')
  const [bookId, setBookId] = useState(read)
  useEffect(() => {
    const handler = () => setBookId(read())
    addEventListener('hashchange', handler)
    return () => removeEventListener('hashchange', handler)
  }, [])
  return bookId
}

async function processFile(file: File, encoding?: Encoding): Promise<Parsed> {
  const id = crypto.randomUUID()
  const buffer = await file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./features/import/decoder.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<{ ok: boolean; error?: string } & Omit<Parsed, 'id'>>) => {
      worker.terminate()
      if (data.ok) resolve({ id, encoding: data.encoding, text: data.text, chunks: data.chunks })
      else reject(new Error(data.error))
    }
    worker.onerror = () => { worker.terminate(); reject(new Error('读取文件失败，请重试')) }
    worker.postMessage({ buffer, bookId: id, encoding }, [buffer])
  })
}

function Library({ notify }: { notify: (notice: Notice) => void }) {
  const books = useLiveQuery(() => db.books.orderBy('lastReadAt').reverse().toArray(), [])
  const progresses = useLiveQuery(() => db.progress.toArray(), []) ?? []
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ file: File; parsed: Parsed } | null>(null)

  const chooseFile = async (file?: File, encoding?: Encoding) => {
    if (!file) return
    setBusy(true)
    notify(null)
    try {
      validateFile(file)
      setPending({ file, parsed: await processFile(file, encoding) })
    } catch (error) {
      notify({ kind: 'error', text: error instanceof Error ? error.message : '导入失败' })
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const confirm = async () => {
    if (!pending) return
    const now = Date.now()
    const { file, parsed } = pending
    const book: Book = {
      id: parsed.id,
      fileName: file.name.replace(/\.txt$/i, ''),
      encoding: parsed.encoding,
      byteSize: file.size,
      totalLength: parsed.text.length,
      chunkCount: parsed.chunks.length,
      importedAt: now,
      lastReadAt: now,
    }
    try {
      await saveBook(book, parsed.chunks)
      setPending(null)
      notify({ kind: 'success', text: `《${book.fileName}》已加入书架` })
    } catch {
      notify({ kind: 'error', text: '浏览器存储失败，书籍没有导入。请检查可用空间后重试。' })
    }
  }

  return <main className="library-shell">
    <header className="library-header">
      <div><span className="eyebrow">YOUR PRIVATE LIBRARY</span><h1>拾页</h1><p>把散落在电脑里的文字，收进一处安静的地方。</p></div>
      <button className="primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? '正在解读…' : '＋ 导入 TXT'}</button>
      <input ref={input} hidden type="file" accept=".txt,text/plain" onChange={event => void chooseFile(event.target.files?.[0])} />
    </header>
    <section className="shelf-head"><h2>最近阅读</h2><span>{books?.length ?? 0} 本藏书</span></section>
    {!books ? <p className="empty">正在打开书架…</p> : books.length === 0 ? <section className="empty">
      <div className="empty-mark">文</div><h2>书架还是空的</h2><p>导入一本 TXT，阅读记录只保存在这个浏览器里。</p>
      <button onClick={() => input.current?.click()}>选择一本书</button>
    </section> : <section className="book-grid">{books.map(book => {
      const progress = progresses.find(item => item.bookId === book.id)
      const percent = Math.min(100, Math.round(((progress?.offset ?? 0) / book.totalLength) * 100))
      return <article className="book-card" key={book.id}>
        <button className="book-open" onClick={() => { location.hash = `/read/${book.id}` }}>
          <div className="book-cover"><span>TXT</span><strong>{book.fileName.slice(0, 12)}</strong></div>
          <div className="book-info"><h3>{book.fileName}</h3><p>{percent === 0 ? '尚未开始' : percent === 100 ? '已读完' : `读至 ${percent}%`}</p><div className="progress"><i style={{ width: `${percent}%` }} /></div><small>{new Date(book.lastReadAt).toLocaleDateString('zh-CN')}</small></div>
        </button>
        <button className="remove" aria-label={`移除${book.fileName}`} onClick={() => void removeBook(book.id).catch(() => notify({ kind: 'error', text: '移除失败，请重试。' }))}>×</button>
      </article>
    })}</section>}
    {pending && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="导入预览">
      <span className="eyebrow">IMPORT PREVIEW</span><h2>文字显示正常吗？</h2><pre>{pending.parsed.text.slice(0, 500)}</pre>
      <div className="encoding"><span>当前编码</span><button className={pending.parsed.encoding === 'utf-8' ? 'active' : ''} onClick={() => void chooseFile(pending.file, 'utf-8')}>UTF-8</button><button className={pending.parsed.encoding === 'gbk' ? 'active' : ''} onClick={() => void chooseFile(pending.file, 'gbk')}>GBK</button></div>
      <div className="modal-actions"><button onClick={() => setPending(null)}>取消</button><button className="primary" onClick={() => void confirm()}>确认导入</button></div>
    </section></div>}
  </main>
}

function Reader({ bookId, notify }: { bookId: string; notify: (notice: Notice) => void }) {
  const book = useLiveQuery(() => db.books.get(bookId), [bookId])
  const chunks = useLiveQuery(() => db.chunks.where('[bookId+index]').between([bookId, 0], [bookId, DexieMaxKey]).toArray(), [bookId])
  const progress = useLiveQuery(() => db.progress.get(bookId), [bookId])
  const [settings, setSettings] = useState<ReaderSettings>(defaultSettings)
  const [panel, setPanel] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const restored = useRef(false)
  const virtual = useVirtualizer({ count: chunks?.length ?? 0, getScrollElement: () => scroller.current, estimateSize: () => settings.fontSize * settings.lineHeight * 8, overscan: 5 })

  useEffect(() => { void getSettings().then(setSettings) }, [])
  useEffect(() => {
    if (book === undefined) return
    if (!book) { notify({ kind: 'error', text: '这本书已经不存在了。' }); location.hash = '/' }
  }, [book, notify])
  useEffect(() => {
    if (chunks && progress && !restored.current) {
      let index = 0
      for (let cursor = 0; cursor < chunks.length; cursor += 1) {
        if (chunks[cursor].start <= progress.offset) index = cursor
        else break
      }
      virtual.scrollToIndex(index, { align: 'start' })
      restored.current = true
    }
  }, [chunks, progress, virtual])

  const persist = useCallback(async () => {
    if (!chunks || !book || !restored.current) return
    const first = virtual.getVirtualItems()[0]
    if (!first) return
    const chunk = chunks[first.index]
    const within = Math.round(Math.max(0, -first.start + (scroller.current?.scrollTop ?? 0)) / Math.max(first.size, 1) * chunk.text.length)
    const offset = Math.min(book.totalLength, chunk.start + within)
    try {
      await db.transaction('rw', db.progress, db.books, async () => {
        await db.progress.put({ bookId, offset, updatedAt: Date.now(), completed: offset >= book.totalLength - 2 })
        await db.books.update(bookId, { lastReadAt: Date.now() })
      })
    } catch {
      notify({ kind: 'error', text: '进度未保存，请保持页面打开并重试。' })
    }
  }, [book, bookId, chunks, notify, virtual])

  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === 'hidden') void persist() }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [persist])

  const onScroll = () => { window.clearTimeout(saveTimer.current); saveTimer.current = window.setTimeout(() => void persist(), 500) }
  const update = (patch: Partial<ReaderSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    requestAnimationFrame(() => virtual.measure())
    void saveSettings(next).catch(() => notify({ kind: 'error', text: '阅读设置未保存。' }))
  }
  if (!book || !chunks) return <div className="reader-loading">正在展开书页…</div>

  const percent = Math.min(100, Math.round(((progress?.offset ?? 0) / book.totalLength) * 100))
  return <div className={`reader theme-${settings.theme}`} style={{ '--font-size': `${settings.fontSize}px`, '--line-height': settings.lineHeight } as CSSProperties}>
    <header className="reader-bar"><button onClick={() => { void persist().finally(() => { location.hash = '/' }) }}>← 书架</button><div><strong>{book.fileName}</strong><span>{percent}%</span></div><button aria-label="阅读设置" onClick={() => setPanel(value => !value)}>Aa</button></header>
    {panel && <aside className="settings">
      <label>字号 <output>{settings.fontSize}</output><input aria-label="字号" type="range" min="15" max="30" value={settings.fontSize} onChange={event => update({ fontSize: Number(event.target.value) })} /></label>
      <label>行距 <output>{settings.lineHeight.toFixed(1)}</output><input aria-label="行距" type="range" min="1.4" max="2.4" step="0.1" value={settings.lineHeight} onChange={event => update({ lineHeight: Number(event.target.value) })} /></label>
      <div className="theme-options"><span>主题</span><button className={settings.theme === 'light' ? 'active' : ''} onClick={() => update({ theme: 'light' })}>纸白</button><button className={settings.theme === 'dark' ? 'active' : ''} onClick={() => update({ theme: 'dark' })}>夜读</button></div>
    </aside>}
    <div className="reading-scroll" ref={scroller} onScroll={onScroll}><div className="reading-space" style={{ height: virtual.getTotalSize() }}>{virtual.getVirtualItems().map(item => <article className="text-chunk" data-index={item.index} ref={virtual.measureElement} key={chunks[item.index].index} style={{ transform: `translateY(${item.start}px)` }}>{chunks[item.index].text}</article>)}</div></div>
  </div>
}

const DexieMaxKey = [[]]

export function App() {
  const bookId = useRoute()
  const [notice, setNotice] = useState<Notice>(null)
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 4500)
    return () => clearTimeout(id)
  }, [notice])
  return <>{bookId ? <Reader bookId={bookId} notify={setNotice} /> : <Library notify={setNotice} />}{notice && <div className={`toast ${notice.kind}`} role="status">{notice.text}<button aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></div>}</>
}
