'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { Todo } from '@/types/todo'
import { TODO_STATUS_LABEL } from '@/types/todo'

export function WorkingTodos({ topicId }: { topicId: string }) {
  const [todos, setTodos] = useState<Todo[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch(`/api/todos?aaaTopicId=${encodeURIComponent(topicId)}`, { credentials: 'include' })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok || !body.success) throw new Error(body.error || '关联 Todo 加载失败')
        if (alive) { setTodos((body.data as Todo[]).filter((todo) => todo.kind === 'action')); setError('') }
      })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : '关联 Todo 加载失败') })
    return () => { alive = false }
  }, [topicId])

  const done = todos.filter((todo) => todo.status === 'done').length
  const active = todos.filter((todo) => todo.status === 'active').length
  const blocked = todos.filter((todo) => todo.status === 'blocked').length

  return <section className="mt-7" aria-label="关联 Todo 统计">
    <h2 className="text-sm font-semibold">关联 Todo</h2>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        ['总数', todos.length], ['已完成', done], ['进行中', active], ['冻结', blocked],
      ].map(([label, value]) => <div key={label} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>)}
    </div>
    {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    <div className="mt-3 space-y-2">
      {todos.map((todo) => <Link key={todo.id} href={`/?todo=${encodeURIComponent(todo.id)}`} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"><span className="min-w-0 truncate">{todo.title}</span><span className="shrink-0 text-xs text-muted-foreground">{TODO_STATUS_LABEL[todo.status]} · 查看详情</span></Link>)}
      {!todos.length && !error && <p className="text-xs text-muted-foreground">暂无关联 Todo。在 Todo 详情中可关联当前 Working。</p>}
    </div>
  </section>
}
