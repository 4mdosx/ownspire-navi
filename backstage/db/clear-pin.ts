#!/usr/bin/env node
/**
 * 清除 SQLite 中保存的访问 PIN。下次打开应用需要重新设置。
 *
 * 用法:
 *   npm run clear-pin
 *   或 DB_FILE_NAME=/path/to/local.db npm run clear-pin
 *
 * ⚠️ 这里**不再自己 CREATE TABLE** —— 以前它先建一张（可能形状和迁移不一致的）
 * settings 表再删，等于「为了让删除不报错，先造一个可能是错的东西」。
 * 现在走 `getDatabase()`，表由迁移建立，形状只有一种可能。
 */
import { config } from 'dotenv'

config()

const PIN_KEYS = ['pin.hash', 'pin.epoch', 'pin.updatedAt']

async function clearPin(): Promise<void> {
  const { databaseFile, getDatabase } = await import('./database')
  const { settings } = await import('./schema')
  const { inArray } = await import('drizzle-orm')

  console.log(`Using database: ${databaseFile()}`)
  const db = await getDatabase()
  const removed = await db.delete(settings).where(inArray(settings.key, PIN_KEYS)).returning({ key: settings.key })

  if (removed.length > 0) {
    console.log(`PIN 已清除（${removed.map((row) => row.key).join(', ')}）。下次进入页面需要重新设置。`)
  } else {
    console.log('当前没有设置 PIN。')
  }
}

clearPin().catch((error) => {
  console.error('清除 PIN 失败:', error)
  process.exit(1)
})
