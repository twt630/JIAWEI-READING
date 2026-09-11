import { beforeEach, describe, expect, it } from 'vitest'
import { db, getSettings, removeBook, saveBook, saveSettings } from './db'
import { defaultSettings, type Book } from '../types'

const makeBook = (id: string): Book => ({ id, fileName: '同名', encoding: 'utf-8', byteSize: 4, totalLength: 4, chunkCount: 1, importedAt: 1, lastReadAt: 1 })

beforeEach(async () => { await db.delete(); await db.open() })

describe('local storage', () => {
  it('stores same-name books independently and removes only the selected book', async () => {
    await saveBook(makeBook('a'), [{ bookId: 'a', index: 0, start: 0, text: '甲乙' }])
    await saveBook(makeBook('b'), [{ bookId: 'b', index: 0, start: 0, text: '丙丁' }])
    await db.bookmarks.add({ id: 'mark-a', bookId: 'a', offset: 1, excerpt: '乙', createdAt: 1 })
    await db.bookmarks.add({ id: 'mark-b', bookId: 'b', offset: 1, excerpt: '丁', createdAt: 1 })
    await removeBook('a')
    expect(await db.books.toArray()).toEqual([expect.objectContaining({ id: 'b' })])
    expect(await db.chunks.toArray()).toEqual([expect.objectContaining({ bookId: 'b' })])
    expect(await db.progress.get('a')).toBeUndefined()
    expect(await db.bookmarks.toArray()).toEqual([expect.objectContaining({ id: 'mark-b' })])
  })

  it('stores multiple bookmarks for one book in reading order', async () => {
    await db.bookmarks.bulkAdd([
      { id: 'later', bookId: 'a', offset: 80, excerpt: '后面的文字', createdAt: 2 },
      { id: 'earlier', bookId: 'a', offset: 20, excerpt: '前面的文字', createdAt: 1 },
    ])
    const bookmarks = await db.bookmarks.where('[bookId+offset]').between(['a', 0], ['a', Infinity]).toArray()
    expect(bookmarks.map(item => item.id)).toEqual(['earlier', 'later'])
  })

  it('persists reader settings', async () => {
    expect(await getSettings()).toEqual(defaultSettings)
    await saveSettings({ ...defaultSettings, fontSize: 24, theme: 'dark' })
    expect(await getSettings()).toEqual(expect.objectContaining({ fontSize: 24, theme: 'dark' }))
  })
})
