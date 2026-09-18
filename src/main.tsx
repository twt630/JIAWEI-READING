import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { migrateLegacyDatabase } from './storage/migrateLegacyDatabase'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

async function start() {
  try {
    await migrateLegacyDatabase()
    root.render(<StrictMode><App /></StrictMode>)
  } catch (error) {
    console.error(error)
    root.render(
      <main className="startup-error" role="alert">
        <h1>无法打开本地书库</h1>
        <p>{error instanceof Error ? error.message : '本地数据初始化失败，请稍后重试。'}</p>
        <p>旧版书库不会被自动删除，你的数据仍保留在当前浏览器中。</p>
      </main>,
    )
  }
}

void start()
