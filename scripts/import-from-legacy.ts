/**
 * 一次性：把「迁移系统之前」手建库里的数据搬进 drizzle 迁移建的新库。
 *
 * 用法：
 *   tsx scripts/import-from-legacy.ts <旧库路径>
 *   （新库用 `DB_FILE_NAME`，缺省是项目根的 local.db）
 *
 * ⚠️ **为什么是「建新库 + 导入」而不是「给旧库补结构」**：旧库里没有
 * `__drizzle_migrations`，而 0000_initial 里的 CREATE TABLE 在已存在的表上会
 * 直接失败 —— 想在旧库上继续用迁移系统，只能伪造一条「已应用」记录，那等于
 * 声明「旧库结构 == 迁移产出的结构」，而这个等式恰恰没法验证（旧库还有两张
 * 没有任何代码引用的遗留表 projects / project_week_items，就是现成的反例）。
 * 建新库的话，结构是迁移**自己**建的，等式天然成立。
 *
 * ⚠️ 顺序是**拓扑序**：被引用的一方先写，反过来会撞外键（这个库开了
 * `PRAGMA foreign_keys = ON`）。
 */
import { config } from 'dotenv'
import { DatabaseSync } from 'node:sqlite'

config()

const legacyPath = process.argv[2]
if (!legacyPath) {
  console.error('用法：tsx scripts/import-from-legacy.ts <旧库路径>')
  process.exit(1)
}

async function main(): Promise<void> {
  const { getDatabase } = await import('@/backstage/db/database')
  const schema = await import('@/backstage/db/schema')

  const legacy = new DatabaseSync(legacyPath)
  const db = await getDatabase()

  const read = <T>(table: string): T[] => {
    const exists = legacy
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table) as { name: string } | undefined
    if (!exists) return []
    return legacy.prepare(`SELECT * FROM ${table}`).all() as T[]
  }

  const rows = {
    settings: read('settings'),
    todos: read('todos'),
    todo_time_links: read('todo_time_links'),
    todo_time_spans: read('todo_time_spans'),
    tags: read('tags'),
    todo_tags: read('todo_tags'),
    focus_modes: read('focus_modes'),
    work_items: read('work_items'),
    execution_sessions: read('execution_sessions'),
    aaa_topics: read('aaa_topics'),
    aaa_entries: read('aaa_entries'),
  }
  for (const [name, list] of Object.entries(rows)) console.log(`  ${name}: 旧库 ${list.length} 行`)

  const copy = async (table: Parameters<typeof db.insert>[0], list: unknown[], name: string): Promise<void> => {
    if (list.length === 0) return
    await db.insert(table).values(list as never[]).onConflictDoNothing()
    console.log(`  → ${name} 已写入`)
  }

  await copy(schema.settings, rows.settings, 'settings')
  await copy(schema.todos, rows.todos, 'todos')
  await copy(schema.todoTimeLinks, rows.todo_time_links, 'todo_time_links')
  await copy(schema.todoTimeSpans, rows.todo_time_spans, 'todo_time_spans')
  await copy(schema.tags, rows.tags, 'tags')
  await copy(schema.todoTags, rows.todo_tags, 'todo_tags')
  await copy(schema.focusModes, rows.focus_modes, 'focus_modes')
  await copy(schema.workItems, rows.work_items, 'work_items')
  await copy(schema.executionSessions, rows.execution_sessions, 'execution_sessions')
  await copy(schema.aaaTopics, rows.aaa_topics, 'aaa_topics')
  await copy(schema.aaaEntries, rows.aaa_entries, 'aaa_entries')

  const counts = {
    settings: (await db.select().from(schema.settings)).length,
    todos: (await db.select().from(schema.todos)).length,
    todo_time_links: (await db.select().from(schema.todoTimeLinks)).length,
    todo_time_spans: (await db.select().from(schema.todoTimeSpans)).length,
    tags: (await db.select().from(schema.tags)).length,
    todo_tags: (await db.select().from(schema.todoTags)).length,
    focus_modes: (await db.select().from(schema.focusModes)).length,
    work_items: (await db.select().from(schema.workItems)).length,
    execution_sessions: (await db.select().from(schema.executionSessions)).length,
    aaa_topics: (await db.select().from(schema.aaaTopics)).length,
    aaa_entries: (await db.select().from(schema.aaaEntries)).length,
  }
  console.log('导入后新库计数：', counts)
  legacy.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
