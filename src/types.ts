export type Encoding = 'utf-8' | 'gbk'
export type Theme = 'light' | 'dark'

export interface Book {
  id: string
  fileName: string
  encoding: Encoding
  byteSize: number
  totalLength: number
  chunkCount: number
  importedAt: number
  lastReadAt: number
}

export interface TextChunk { id?: number; bookId: string; index: number; start: number; text: string }
export interface Progress { bookId: string; offset: number; updatedAt: number; completed: boolean }
export interface Bookmark { id: string; bookId: string; offset: number; excerpt: string; createdAt: number }
export interface ReaderSettings { id: 'global'; fontSize: number; lineHeight: number; theme: Theme }

export const defaultSettings: ReaderSettings = { id: 'global', fontSize: 20, lineHeight: 1.9, theme: 'light' }
