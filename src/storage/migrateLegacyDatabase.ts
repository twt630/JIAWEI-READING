import Dexie, { type EntityTable } from 'dexie'
import type { Book, Bookmark, Progress, ReaderSettings, TextChunk } from '../types'
import {
  db,
  LEGACY_DATABASE_NAME,
  type BusinessTableName,
  type MigrationRecord,
  ReadingDatabase,
} from './db'

export const LEGACY_MIGRATION_KEY = 'legacy-shiyue-reader-v1'

const businessTables: BusinessTableName[] = ['books', 'chunks', 'progress', 'settings', 'bookmarks']
const emptyCounts = (): Record<BusinessTableName, number> => ({
  books: 0,
  chunks: 0,
  progress: 0,
  settings: 0,
  bookmarks: 0,
})

export class LegacyReadingDatabase extends Dexie {
  books!: EntityTable<Book, 'id'>
  chunks!: EntityTable<TextChunk, 'id'>
  progress!: EntityTable<Progress, 'bookId'>
  settings!: EntityTable<ReaderSettings, 'id'>
  bookmarks!: EntityTable<Bookmark, 'id'>

  constructor(name = LEGACY_DATABASE_NAME) {
    super(name)
    this.version(1).stores({ books: 'id,lastReadAt,importedAt', chunks: '++id,[bookId+index],bookId,start', progress: 'bookId', settings: 'id' })
    this.version(2).stores({ bookmarks: 'id,[bookId+offset],bookId,createdAt' })
  }
}

export class DatabaseMigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DatabaseMigrationError'
  }
}

type Snapshot = {
  books: Book[]
  chunks: TextChunk[]
  progress: Progress[]
  settings: ReaderSettings[]
  bookmarks: Bookmark[]
}

export interface MigrationOptions {
  target?: ReadingDatabase
  legacyName?: string
}

async function countTarget(target: ReadingDatabase) {
  const values = await target.transaction(
    'r',
    target.books,
    target.chunks,
    target.progress,
    target.settings,
    target.bookmarks,
    () => Promise.all([
      target.books.count(),
      target.chunks.count(),
      target.progress.count(),
      target.settings.count(),
      target.bookmarks.count(),
    ]),
  )
  return Object.fromEntries(businessTables.map((table, index) => [table, values[index]])) as Record<BusinessTableName, number>
}

async function readLegacy(source: LegacyReadingDatabase): Promise<Snapshot> {
  return source.transaction(
    'r',
    source.books,
    source.chunks,
    source.progress,
    source.settings,
    source.bookmarks,
    async () => ({
      books: await source.books.toArray(),
      chunks: await source.chunks.toArray(),
      progress: await source.progress.toArray(),
      settings: await source.settings.toArray(),
      bookmarks: await source.bookmarks.toArray(),
    }),
  )
}

function countsFor(snapshot: Snapshot): Record<BusinessTableName, number> {
  return {
    books: snapshot.books.length,
    chunks: snapshot.chunks.length,
    progress: snapshot.progress.length,
    settings: snapshot.settings.length,
    bookmarks: snapshot.bookmarks.length,
  }
}

function migrationRecord(
  outcome: MigrationRecord['outcome'],
  sourceCounts: Record<BusinessTableName, number>,
  reason?: MigrationRecord['reason'],
): MigrationRecord {
  return { key: LEGACY_MIGRATION_KEY, outcome, reason, sourceCounts, completedAt: Date.now() }
}

export async function migrateLegacyDatabase({
  target = db,
  legacyName = LEGACY_DATABASE_NAME,
}: MigrationOptions = {}): Promise<MigrationRecord> {
  const existingMarker = await target.migrationMeta.get(LEGACY_MIGRATION_KEY)
  if (existingMarker) return existingMarker

  const targetCounts = await countTarget(target)
  if (businessTables.some(table => targetCounts[table] > 0)) {
    throw new DatabaseMigrationError(
      '检测到新的本地书库已有数据，但没有迁移记录。为避免覆盖，已停止启动。',
    )
  }

  if (!(await Dexie.exists(legacyName))) {
    const marker = migrationRecord('not-needed', emptyCounts(), 'legacy-missing')
    await target.transaction('rw', target.migrationMeta, () => target.migrationMeta.add(marker))
    return marker
  }

  const source = new LegacyReadingDatabase(legacyName)
  try {
    const snapshot = await readLegacy(source)
    const sourceCounts = countsFor(snapshot)
    const sourceIsEmpty = businessTables.every(table => sourceCounts[table] === 0)

    if (sourceIsEmpty) {
      const marker = migrationRecord('not-needed', sourceCounts, 'legacy-empty')
      await target.transaction('rw', target.migrationMeta, () => target.migrationMeta.add(marker))
      return marker
    }

    const marker = migrationRecord('migrated', sourceCounts)
    await target.transaction(
      'rw',
      [
        target.books,
        target.chunks,
        target.progress,
        target.settings,
        target.bookmarks,
        target.migrationMeta,
      ],
      async () => {
        if (snapshot.books.length) await target.books.bulkAdd(snapshot.books)
        if (snapshot.chunks.length) await target.chunks.bulkAdd(snapshot.chunks)
        if (snapshot.progress.length) await target.progress.bulkAdd(snapshot.progress)
        if (snapshot.settings.length) await target.settings.bulkAdd(snapshot.settings)
        if (snapshot.bookmarks.length) await target.bookmarks.bulkAdd(snapshot.bookmarks)

        const copiedCounts = await Promise.all([
          target.books.count(),
          target.chunks.count(),
          target.progress.count(),
          target.settings.count(),
          target.bookmarks.count(),
        ])
        for (let index = 0; index < businessTables.length; index += 1) {
          const table = businessTables[index]
          if (copiedCounts[index] !== sourceCounts[table]) {
            throw new DatabaseMigrationError(`迁移校验失败：${table} 数据数量不一致。`)
          }
        }
        await target.migrationMeta.add(marker)
      },
    )
    return marker
  } catch (error) {
    throw new DatabaseMigrationError(
      '旧版阅读数据迁移失败。旧数据仍然保留，请勿清除浏览器网站数据。',
      { cause: error },
    )
  } finally {
    source.close()
  }
}
