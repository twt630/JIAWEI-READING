import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Book, defaultSettings } from '../types'
import { ReadingDatabase } from './db'
import {
  LEGACY_MIGRATION_KEY,
  LegacyReadingDatabase,
  migrateLegacyDatabase,
} from './migrateLegacyDatabase'

let sequence = 0
const opened: Dexie[] = []
const names: string[] = []

function uniqueName(label: string) {
  const name = `migration-test-${label}-${sequence += 1}`
  names.push(name)
  return name
}

function targetDatabase(label: string) {
  const database = new ReadingDatabase(uniqueName(`target-${label}`))
  opened.push(database)
  return database
}

function legacyDatabase(label: string) {
  const database = new LegacyReadingDatabase(uniqueName(`legacy-${label}`))
  opened.push(database)
  return database
}

const book: Book = {
  id: 'book-1',
  fileName: '旧书',
  encoding: 'utf-8',
  byteSize: 12,
  totalLength: 6,
  chunkCount: 2,
  importedAt: 10,
  lastReadAt: 20,
}

async function seedAllTables(source: LegacyReadingDatabase) {
  await source.transaction(
    'rw',
    source.books,
    source.chunks,
    source.progress,
    source.settings,
    source.bookmarks,
    async () => {
      await source.books.add(book)
      await source.chunks.bulkAdd([
        { id: 41, bookId: book.id, index: 0, start: 0, text: '第一段' },
        { id: 42, bookId: book.id, index: 1, start: 3, text: '第二段' },
      ])
      await source.progress.add({ bookId: book.id, offset: 4, updatedAt: 30, completed: false })
      await source.settings.add({ ...defaultSettings, fontSize: 24, theme: 'dark' })
      await source.bookmarks.add({ id: 'bookmark-1', bookId: book.id, offset: 3, excerpt: '第二段', createdAt: 40 })
    },
  )
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const database of opened.splice(0)) database.close()
  await Promise.all(names.splice(0).map(name => Dexie.delete(name)))
})

describe('legacy database migration', () => {
  it('migrates all five business tables and preserves progress, settings, bookmarks, and chunk keys', async () => {
    const source = legacyDatabase('complete')
    await seedAllTables(source)
    const target = targetDatabase('complete')

    const result = await migrateLegacyDatabase({ target, legacyName: source.name })

    expect(result.outcome).toBe('migrated')
    expect(result.sourceCounts).toEqual({ books: 1, chunks: 2, progress: 1, settings: 1, bookmarks: 1 })
    expect(await target.books.toArray()).toEqual([book])
    expect(await target.chunks.orderBy('id').toArray()).toEqual([
      { id: 41, bookId: book.id, index: 0, start: 0, text: '第一段' },
      { id: 42, bookId: book.id, index: 1, start: 3, text: '第二段' },
    ])
    expect(await target.progress.get(book.id)).toEqual({ bookId: book.id, offset: 4, updatedAt: 30, completed: false })
    expect(await target.settings.get('global')).toEqual({ ...defaultSettings, fontSize: 24, theme: 'dark' })
    expect(await target.bookmarks.get('bookmark-1')).toEqual({ id: 'bookmark-1', bookId: book.id, offset: 3, excerpt: '第二段', createdAt: 40 })
    expect(await target.migrationMeta.get(LEGACY_MIGRATION_KEY)).toEqual(result)
    expect(await Dexie.exists(source.name)).toBe(true)
  })

  it('is idempotent and does not duplicate data when run repeatedly', async () => {
    const source = legacyDatabase('repeat')
    await seedAllTables(source)
    const target = targetDatabase('repeat')

    const first = await migrateLegacyDatabase({ target, legacyName: source.name })
    const second = await migrateLegacyDatabase({ target, legacyName: source.name })

    expect(second).toEqual(first)
    expect(await target.books.count()).toBe(1)
    expect(await target.chunks.count()).toBe(2)
    expect(await target.progress.count()).toBe(1)
    expect(await target.settings.count()).toBe(1)
    expect(await target.bookmarks.count()).toBe(1)
  })

  it('starts normally and records a no-migration result when the legacy database is absent', async () => {
    const target = targetDatabase('missing')
    const missingLegacyName = uniqueName('does-not-exist')

    const result = await migrateLegacyDatabase({ target, legacyName: missingLegacyName })

    expect(result).toEqual(expect.objectContaining({
      key: LEGACY_MIGRATION_KEY,
      outcome: 'not-needed',
      reason: 'legacy-missing',
      sourceCounts: { books: 0, chunks: 0, progress: 0, settings: 0, bookmarks: 0 },
    }))
    expect(await target.migrationMeta.get(LEGACY_MIGRATION_KEY)).toEqual(result)
    expect(await Dexie.exists(missingLegacyName)).toBe(false)
  })

  it('does not overwrite a non-empty target that has no migration marker', async () => {
    const source = legacyDatabase('conflict')
    await seedAllTables(source)
    const target = targetDatabase('conflict')
    await target.books.add({ ...book, id: 'new-book', fileName: '新书' })

    await expect(migrateLegacyDatabase({ target, legacyName: source.name }))
      .rejects.toThrow('已有数据')

    expect(await target.books.toArray()).toEqual([expect.objectContaining({ id: 'new-book' })])
    expect(await target.migrationMeta.get(LEGACY_MIGRATION_KEY)).toBeUndefined()
    expect(await source.books.get(book.id)).toEqual(book)
  })

  it('rolls back the new database and leaves the legacy database intact when copying fails', async () => {
    const source = legacyDatabase('failure')
    await seedAllTables(source)
    const target = targetDatabase('failure')
    vi.spyOn(target.bookmarks, 'bulkAdd').mockRejectedValueOnce(new Error('forced copy failure'))

    await expect(migrateLegacyDatabase({ target, legacyName: source.name }))
      .rejects.toThrow('旧版阅读数据迁移失败')

    expect(await target.books.count()).toBe(0)
    expect(await target.chunks.count()).toBe(0)
    expect(await target.progress.count()).toBe(0)
    expect(await target.settings.count()).toBe(0)
    expect(await target.bookmarks.count()).toBe(0)
    expect(await target.migrationMeta.get(LEGACY_MIGRATION_KEY)).toBeUndefined()
    expect(await source.books.get(book.id)).toEqual(book)
    expect(await source.bookmarks.get('bookmark-1')).toEqual(expect.objectContaining({ bookId: book.id }))
    expect(await Dexie.exists(source.name)).toBe(true)
  })
})
