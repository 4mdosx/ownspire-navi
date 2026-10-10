import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite'
import { migrate } from 'drizzle-orm/node-sqlite/migrator'

export type AppDatabase = NodeSQLiteDatabase

/** `.env` 里的 `DB_FILE_NAME=file:local.db` 带 URI 前缀，`node:sqlite` 不认。 */
const dbPath = process.env.DB_FILE_NAME
  ? process.env.DB_FILE_NAME.replace(/^file:/, '')
  : path.join(process.cwd(), 'local.db')

/**
 * ⚠️ 连接**必须是可重开的**，不能是模块级常量。
 *
 * 原来这里是 `const sqlite = new DatabaseSync(dbPath)`，而 `closeDatabase()` 里
 * `sqlite.close()` 把它关掉后**再也开不回来** —— 任何「关库 → 重开」的路径都
 * 跑不了，症状是 `Failed query` 之类完全指不到「连接已经关了」的报错
 * （atlas 2026-10-06 踩过同一个坑，那里有完整记录）。
 *
 * 所以改成 getter 惰性打开，关掉后置空 —— 下次调用自动重连。
 * ⚠️ 惰性还带来一个好处：不在 import 时建连接，于是「先设 DB_FILE_NAME 再
 * 首次打开」这种用法成立（验证脚本正需要）。
 */
let connection: DatabaseSync | null = null

function sqlite(): DatabaseSync {
  if (connection) return connection
  const opened = new DatabaseSync(dbPath)
  // ⭐ 连接建立时立刻设这几项 —— 它们是**连接级**设置，不是查询级。
  //
  // ⚠️ `foreign_keys = ON` **必须在这里设**。SQLite 默认不检查外键，而 todos
  // 的父子树、todo_tags / todo_time_spans 全靠 `ON DELETE CASCADE` 级联清理。
  // 少了这一行，「删父节点留下孤儿子树」不会报任何错 —— 这种静默错误比
  // 停下来问贵得多。（原来这条藏在 todo-migrate.ts 里，只有跑迁移时才设上。）
  //
  // ⚠️ `busy_timeout` 是修「读时报 database is locked」的标准解法（默认 0ms
  // 意味着一撞到锁就立刻报错）。dev server 与脚本常同时开着，没有它就是
  // 随机失败。
  //
  // ⚠️ `journal_mode = WAL` 让读不阻塞写；`synchronous = NORMAL` 是它的配套，
  // 省掉每次事务的 fsync —— 丢一次事务可以接受，每次 fsync 会让记录变卡。
  for (const pragma of [
    'PRAGMA foreign_keys = ON',
    'PRAGMA busy_timeout = 5000',
    'PRAGMA journal_mode = WAL',
    'PRAGMA synchronous = NORMAL',
  ]) {
    opened.exec(pragma)
  }
  connection = opened
  return opened
}

/**
 * 迁移文件的位置。
 *
 * ⚠️ 这是**运行时**读的目录，不是构建期打包进 bundle 的资源 —— 容器镜像里
 * 必须把 `drizzle/` 一起 COPY 进去（Dockerfile 里有这一行，别删）。
 */
function migrationsFolder(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), 'drizzle')
}

const globalForDb = globalThis as unknown as { db: AppDatabase | undefined }

function db(): AppDatabase {
  if (!globalForDb.db) globalForDb.db = drizzle({ client: sqlite() })
  return globalForDb.db
}

let schemaReady = false

/**
 * ⭐ 结构由 drizzle 迁移建立（`drizzle-kit generate` 产出，`schema.ts` 是唯一真相）。
 *
 * ⚠️ **这里不再有第二份建表 SQL，也不再有 SCHEMA_VERSION 常量。** 之前是
 * 「手写 CREATE TABLE / ALTER TABLE + 一个版本号 + 两个迁移脚本」，而 schema.ts
 * 是第三份描述 —— 三处各写一遍，改一处漏两处没有任何报错路径。现在唯一一份
 * 是 schema.ts，运行时自动跑到最新。
 */
async function ensureSchema(): Promise<void> {
  if (schemaReady) return
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  migrate(db(), { migrationsFolder: migrationsFolder() })
  schemaReady = true
}

export async function pingDatabase(): Promise<void> {
  await ensureSchema()
  sqlite().prepare('SELECT 1').get()
}

export async function getDatabase(): Promise<AppDatabase> {
  await ensureSchema()
  return db()
}

export async function closeDatabase(): Promise<void> {
  globalForDb.db = undefined
  // ⚠️ 必须置空 connection —— 否则下次 `sqlite()` 拿到的是已关闭的句柄。
  connection?.close()
  connection = null
  // ⚠️ schemaReady 也必须清零 —— 不然重开后会因为「本进程迁移过了」直接
  // return，跳过全部迁移。新连接面对的是同一个文件，理应重新确认一次。
  schemaReady = false
}

/** 容器启动前先探测数据库可用 —— /healthz 要返回这个。 */
export function databaseFile(): string {
  return dbPath
}
