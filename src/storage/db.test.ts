import { beforeEach, describe, expect, it } from 'vitest'
import { db, getSettings, removeBook, saveBook, saveSettings } from './db'
import { defaultSettings, type Book } from '../types'

const makeBook = (id: string): Book => ({ id, fileName: '同名', encoding: 'utf-8', byteSize: 4, totalLength: 4, chunkCount: 1, importedAt: 1, lastReadAt: 1 })

beforeEach(async () => { await db.delete(); await db.open() })

describe('local storage', () => {
  it('stores same-name books independently and removes only the selected book', async () => {
    await saveBook(makeBook('a'), [{ bookId: 'a', index: 0, start: 0, text: '甲乙' }])
    await saveBook(makeBook('b'), [{ bookId: 'b', index: 0, start: 0, text: '丙丁' }])
    await removeBook('a')
    expect(await db.books.toArray()).toEqual([expect.objectContaining({ id: 'b' })])
    expect(await db.chunks.toArray()).toEqual([expect.objectContaining({ bookId: 'b' })])
    expect(await db.progress.get('a')).toBeUndefined()
  })

  it('persists reader settings', async () => {
    expect(await getSettings()).toEqual(defaultSettings)
    await saveSettings({ ...defaultSettings, fontSize: 24, theme: 'dark' })
    expect(await getSettings()).toEqual(expect.objectContaining({ fontSize: 24, theme: 'dark' }))
  })
})
