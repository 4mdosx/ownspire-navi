#!/usr/bin/env node
/**
 * 数据库初始化 —— 现在只做一件事：把迁移跑到最新。
 *
 * ⚠️ 这个文件以前是**第三份建表 SQL**（与 `database.ts`、`schema.ts` 并列），
 * 每次加表要在三处各写一遍。现在结构只有 schema.ts 一份，运行时 `getDatabase()`
 * 也会自动 migrate —— 这个脚本保留下来是为了让「结构没跟上」在部署时单独响，
 * 而不是混在第一次请求的 500 里。
 *
 * 用法:
 *   npm run init-db
 *   或 DB_FILE_NAME=/path/to/new.db npm run init-db
 */
import { config } from 'dotenv'

config()

async function main(): Promise<void> {
  const { databaseFile, getDatabase } = await import('./database')
  await getDatabase()
  console.log(`✓ 迁移已到最新：${databaseFile()}`)
}

main().catch((error) => {
  console.error('✗ 初始化失败:', error)
  process.exit(1)
})
