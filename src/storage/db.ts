import Dexie, { type EntityTable } from 'dexie'
import type { Book, Progress, ReaderSettings, TextChunk } from '../types'
import { defaultSettings } from '../types'

class ReadingDatabase extends Dexie {
  books!: EntityTable<Book, 'id'>
  chunks!: EntityTable<TextChunk, 'id'>
  progress!: EntityTable<Progress, 'bookId'>
  settings!: EntityTable<ReaderSettings, 'id'>

  constructor() {
    super('shiyue-reader')
    this.version(1).stores({ books: 'id,lastReadAt,importedAt', chunks: '++id,[bookId+index],bookId,start', progress: 'bookId', settings: 'id' })
  }
}

export const db = new ReadingDatabase()

export async function saveBook(book: Book, chunks: TextChunk[]) {
  await db.transaction('rw', db.books, db.chunks, db.progress, async () => {
    await db.books.add(book)
    await db.chunks.bulkAdd(chunks)
    await db.progress.add({ bookId: book.id, offset: 0, updatedAt: Date.now(), completed: false })
  })
}

export async function removeBook(id: string) {
  await db.transaction('rw', db.books, db.chunks, db.progress, async () => {
    await db.books.delete(id)
    await db.chunks.where('bookId').equals(id).delete()
    await db.progress.delete(id)
  })
}

export async function getSettings() { return (await db.settings.get('global')) ?? defaultSettings }
export async function saveSettings(settings: ReaderSettings) { await db.settings.put(settings) }
