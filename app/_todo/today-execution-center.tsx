'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, ChevronLeft, ChevronRight, CornerUpLeft, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { isEditableNote, isNoteKind, isRestKind, isStatusChangeNote, TODO_STATUS_LABEL, type Todo, type TodoStatus, type TodoTimeSpan } from '@/types/todo'
import type { TodayExecution } from '@/types/execution'
import { formatDateKey, shiftWeekStart } from '@/backstage/week-plan/week-utils'
import { noteChildrenOf } from '@/lib/todo-outline'
import { formatWeekStartClient } from './week-plan-api'
import { WeekOutline } from './week-outline'
import { EstimatedMinutesControl, StatusGlyph, StatusPicker, STATUS_TOKEN } from './todo-status'
import { TodoHashtags } from './todo-tags'
import { TimeProgressBackdrop } from './time-progress-backdrop'
import { WorkZone } from './work-zone'
import { DayTimelinePanel } from './day-timeline-panel'
import { formatDuration, totalSpanMs } from './todo-time'
import { sessionLimitMs } from '@/lib/todo-session'
import { ensureNotificationPermission, notifySessionEnded } from './session-notify'
import type { WorkspaceViewId } from './app-toolbar'
import { MobileSheet } from './mobile-chrome'
import { closePhonePanel, openPhonePanel } from './phone-panel'
import { useNoHover, usePhoneLayout } from './use-phone-layout'

type Detail = { title: string; description: string; plannedMinutes: number; meta?: string; todoId?: string }
type TodoPatch = { status?: TodoStatus; estimatedMinutes?: number; title?: string; description?: string; aaaTopicId?: string | null }

function WeekSwitcher({ weekStart, onChange }: { weekStart: string; onChange: (weekStart: string) => void }) {
  const currentWeek = formatWeekStartClient(new Date())
  const isCurrentWeek = weekStart === currentWeek
  return (
    <div className="relative z-10 flex min-w-0 items-center gap-1">
      <button type="button" onClick={() => onChange(shiftWeekStart(weekStart, -1))} className="touch-hit inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="上一周">
        <ChevronLeft className="size-4" />
      </button>
      <p className="min-w-28 text-center text-xs font-medium tabular-nums">{weekStart} 起</p>
      <button type="button" onClick={() => onChange(shiftWeekStart(weekStart, 1))} className="touch-hit inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="下一周">
        <ChevronRight className="size-4" />
      </button>
      {!isCurrentWeek && (
        <button type="button" onClick={() => onChange(currentWeek)} className="touch-hit ml-1 text-xs text-primary hover:underline md:text-[10px]">回到本周</button>
      )}
    </div>
  )
}

export function TodayExecutionCenter({
  todos,
  todosReady = true,
  view,
  onViewChange,
  onTodosChanged,
  onExecutionChanged,
}: {
  todos: Todo[]
  todosReady?: boolean
  view: WorkspaceViewId
  onViewChange?: (view: WorkspaceViewId) => void
  onTodosChanged: () => void
  onExecutionChanged: () => void
}) {
  const phone = usePhoneLayout()
  const router = useRouter()
  const searchParams = useSearchParams()
  const panel = searchParams.get('panel')
  const panelId = searchParams.get('id')
  const panelDate = searchParams.get('date')
  const [weekStart, setWeekStart] = useState(() => formatWeekStartClient(new Date()))
  const [noteDraft, setNoteDraft] = useState('')
  const [focusNotes, setFocusNotes] = useState(false)
  const [, setData] = useState<TodayExecution>({ items: [], sessions: [] })
  const [selected, setSelected] = useState<Detail | null>(null)
  const [spans, setSpans] = useState<TodoTimeSpan[]>([])
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [selectedSpans, setSelectedSpans] = useState<TodoTimeSpan[]>([])
  const [now, setNow] = useState<number | null>(null)
  const endingSpanIds = useRef(new Set<string>())
  const load = useCallback(() => fetch('/api/execution/today').then((r) => r.json()).then((r) => setData(r.data)), [])
  const spanRange = useMemo(() => {
    const start = new Date(`${weekStart}T00:00:00`)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const from = new Date(Math.min(start.getTime(), today.getTime()))
    const weekEnd = new Date(start)
    weekEnd.setDate(weekEnd.getDate() + 7)
    const to = new Date(Math.max(weekEnd.getTime(), Date.now()))
    return { from: from.toISOString(), to: to.toISOString() }
  }, [weekStart])
  const loadSpans = useCallback(() => {
    const query = new URLSearchParams(spanRange)
    return fetch(`/api/todo-time-spans?${query}`, { credentials: 'include' })
      .then((response) => response.json())
      .then((result) => {
        if (!result.success) throw new Error(result.error || '时间记录加载失败')
        setSpans(Array.isArray(result.data) ? result.data : [])
      })
      .catch(() => undefined)
  }, [spanRange])
  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadSpans() }, [loadSpans])
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const hasOpen = spans.some((span) => span.endedAt == null)
    const timer = window.setInterval(tick, hasOpen ? 1000 : 30_000)
    return () => window.clearInterval(timer)
  }, [spans])
  const handleTodosChanged = useCallback(() => {
    onTodosChanged()
    void loadSpans()
  }, [onTodosChanged, loadSpans])
  const promote = async (todoId: string) => {
    const response = await fetch('/api/execution/today', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'promote', todoId }) })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.error || '加入今天失败')
    setData(result.data)
    onTodosChanged()
    onExecutionChanged()
    onViewChange?.('today')
  }
  const removeFromToday = async (todoId: string) => {
    const response = await fetch('/api/execution/today', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', todoId }) })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.error || '移出今日失败')
    setData(result.data)
    onTodosChanged()
    onExecutionChanged()
  }
  const mutateWorkspace = useCallback(async (action: 'enter' | 'leave' | 'rest', todoId?: string) => {
    if (action === 'enter' || action === 'rest') void ensureNotificationPermission()
    const query = new URLSearchParams(spanRange)
    const response = await fetch(`/api/todo-time-spans?${query}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'rest' ? { action } : { action, todoId }),
    })
    const result = await response.json()
    if (!response.ok || !result.success) {
      const failed = action === 'rest' ? '开始休息失败' : action === 'enter' ? '进入工作区失败' : '移出工作区失败'
      throw new Error(result.error || failed)
    }
    if (Array.isArray(result.data?.spans)) setSpans(result.data.spans)
    else void loadSpans()
    onTodosChanged()
    onExecutionChanged()
  }, [spanRange, loadSpans, onTodosChanged, onExecutionChanged])
  const enterWorkspace = useCallback((todoId: string) => { void mutateWorkspace('enter', todoId) }, [mutateWorkspace])
  const leaveWorkspace = useCallback((todoId: string) => { void mutateWorkspace('leave', todoId) }, [mutateWorkspace])
  const startRest = useCallback(() => { void mutateWorkspace('rest') }, [mutateWorkspace])
  const todoById = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos])
  useEffect(() => {
    const timers: number[] = []
    const open = spans.filter((span) => span.endedAt == null)
    for (const span of open) {
      const todo = todoById.get(span.todoId)
      if (!todo || isNoteKind(todo.kind)) continue
      const remaining = Date.parse(span.startedAt) + sessionLimitMs(todo.kind) - Date.now()
      const endSession = () => {
        if (endingSpanIds.current.has(span.id)) return
        endingSpanIds.current.add(span.id)
        void mutateWorkspace('leave', todo.id)
          .then(() => notifySessionEnded(todo))
          .finally(() => { endingSpanIds.current.delete(span.id) })
      }
      if (remaining <= 0) endSession()
      else timers.push(window.setTimeout(endSession, remaining))
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [spans, todoById, mutateWorkspace])
  const showTodo = useCallback((todo: Todo) => {
    const parent = todo.parentId ? todoById.get(todo.parentId)?.title : null
    setSelectedDay(null)
    setSelected({
      title: todo.title,
      description: todo.description,
      plannedMinutes: todo.estimatedMinutes,
      meta: parent ? `属于：${parent}` : undefined,
      todoId: todo.id,
    })
  }, [todoById])
  const selectTodo = (todo: Todo) => {
    if (isRestKind(todo.kind)) {
      const today = formatDateKey(new Date())
      if (phone) {
        openPhonePanel(router, `/?panel=day&date=${today}`)
        return
      }
      setSelected(null)
      setSelectedDay(today)
      return
    }
    if (phone) {
      openPhonePanel(router, `/?panel=task&id=${encodeURIComponent(todo.id)}`)
      return
    }
    showTodo(todo)
  }
  const selectDay = (dateKey: string) => {
    if (phone) {
      openPhonePanel(router, `/?panel=day&date=${encodeURIComponent(dateKey)}`)
      return
    }
    setSelected(null)
    setSelectedDay(dateKey)
  }
  const closeDetail = () => {
    if (phone) {
      closePhonePanel(router)
      return
    }
    setSelected(null)
    setSelectedDay(null)
  }
  useEffect(() => {
    if (!phone) return
    if (panel === 'task' && panelId) {
      const todo = todoById.get(panelId)
      if (!todo || isRestKind(todo.kind)) return
      showTodo(todo)
      return
    }
    if (panel === 'day' && panelDate) {
      setSelected(null)
      setSelectedDay(panelDate)
      return
    }
    if (panel !== 'insights') {
      setSelected(null)
      setSelectedDay(null)
    }
  }, [phone, panel, panelId, panelDate, showTodo, todoById])
  const selectedTodo = selected?.todoId ? todoById.get(selected.todoId) : null
  const selectedParent = selectedTodo?.parentId ? todoById.get(selectedTodo.parentId) : null
  const selectedNotes = selectedTodo ? noteChildrenOf(todos, selectedTodo.id) : []
  useEffect(() => {
    setSelectedSpans([])
    if (!selected?.todoId) return
    let cancelled = false
    fetch(`/api/todo-time-spans?todoId=${encodeURIComponent(selected.todoId)}`, { credentials: 'include' })
      .then((response) => response.json())
      .then((result) => {
        if (cancelled || !result.success) return
        setSelectedSpans(Array.isArray(result.data) ? result.data : [])
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [selected?.todoId, spans])
  const actualMs = selectedSpans.length > 0 && now != null ? totalSpanMs(selectedSpans, now) : null
  const addNote = async () => {
    if (!selectedTodo || !noteDraft.trim()) return
    const response = await fetch('/api/todos', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: noteDraft.trim(),
        parentId: selectedTodo.id,
        kind: 'note',
        noteType: 'user',
        estimatedMinutes: 0,
      }),
    })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.error || '备注添加失败')
    setNoteDraft('')
    onTodosChanged()
  }
  const updateNote = async (note: Todo, title: string) => {
    if (!isEditableNote(note)) return
    const nextTitle = title.trim()
    if (!nextTitle || nextTitle === note.title) return
    const response = await fetch(`/api/todos/${encodeURIComponent(note.id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: nextTitle, version: note.version }),
    })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.error || '备注更新失败')
    onTodosChanged()
  }
  const deleteNote = async (note: Todo) => {
    if (!isEditableNote(note)) return
    const response = await fetch(`/api/todos/${encodeURIComponent(note.id)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.error || '备注删除失败')
    onTodosChanged()
  }
  const patchTodo = async (todo: Todo, input: TodoPatch) => {
    const response = await fetch(`/api/todos/${encodeURIComponent(todo.id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, version: todo.version }),
    })
    const result = await response.json()
    if (!response.ok || !result.success) throw new Error(result.error || '任务更新失败')
    const updated = result.data as Todo | undefined
    if (updated && (input.title != null || input.description != null)) {
      setSelected((current) => {
        if (!current || current.todoId !== todo.id) return current
        return {
          ...current,
          title: updated.title,
          description: updated.description,
          plannedMinutes: updated.estimatedMinutes,
        }
      })
    }
    handleTodosChanged()
  }
  const openNotes = (todo: Todo) => {
    setFocusNotes(true)
    selectTodo(todo)
  }
  const workspaceTodoIds = useMemo(() => {
    const ids = new Set<string>()
    for (const span of spans) {
      if (span.endedAt == null) ids.add(span.todoId)
    }
    return ids
  }, [spans])
  const detailTitle = selectedDay ? formatDayTitle(selectedDay) : (selectedTodo?.title || selected?.title || '任务')
  const detailBody = selectedDay ? (
    <DayTimelinePanel dateKey={selectedDay} todos={todos} spans={spans} now={now ?? 0} onSelectTodo={selectTodo} />
  ) : selected ? (
    <TaskDetailPanel
      selected={selected}
      selectedTodo={selectedTodo}
      selectedParent={selectedParent}
      selectedNotes={selectedNotes}
      actualMs={actualMs}
      noteDraft={noteDraft}
      focusNotes={focusNotes}
      onSelectTodo={selectTodo}
      onNoteDraft={setNoteDraft}
      onFocusNotesHandled={() => setFocusNotes(false)}
      onAddNote={addNote}
      onUpdateNote={updateNote}
      onDeleteNote={deleteNote}
      onPatchTodo={patchTodo}
      onTagsChanged={handleTodosChanged}
    />
  ) : (
    <p className="mt-3 text-xs text-muted-foreground">选择任务，或点时间条查看这一天。</p>
  )
  return <div className="grid h-full min-h-0 flex-1 grid-cols-1 md:h-auto md:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] md:gap-3">
    <section className="flex min-h-0 flex-col overflow-hidden bg-card md:rounded-lg md:border">
      <header className={cn('relative shrink-0 border-b', phone ? 'px-3 pt-2 pb-2' : 'flex items-center gap-3 overflow-hidden px-3 pt-2.5 pb-3.5')} aria-label="今天与本周时间进度">
        {phone ? (
          <div className="flex flex-col gap-2">
            <WeekSwitcher weekStart={weekStart} onChange={setWeekStart} />
            <TimeProgressBackdrop overlay={false} weekStart={weekStart} spans={spans} todos={todos} now={now} selectedDate={selectedDay} onSelectDay={selectDay} />
          </div>
        ) : (
          <>
            <TimeProgressBackdrop weekStart={weekStart} spans={spans} todos={todos} now={now} selectedDate={selectedDay} onSelectDay={selectDay} />
            <WeekSwitcher weekStart={weekStart} onChange={setWeekStart} />
          </>
        )}
      </header>
      <WorkZone
        todos={todos}
        spans={spans}
        now={now ?? 0}
        onEnter={enterWorkspace}
        onLeave={leaveWorkspace}
        onRest={startRest}
        onSelect={selectTodo}
      />
      <WeekOutline
        todos={todos}
        ready={todosReady}
        timeGrain={view === 'week' ? 'week' : 'day'}
        weekStart={weekStart}
        onTodosChanged={handleTodosChanged}
        onPromote={(todoId) => void promote(todoId)}
        onRemoveFromToday={view === 'today' ? (todoId) => void removeFromToday(todoId) : undefined}
        onSelect={selectTodo}
        onOpenNotes={openNotes}
        onEnterWorkspace={enterWorkspace}
        onLeaveWorkspace={leaveWorkspace}
        selectedId={selected?.todoId ?? null}
        workspaceTodoIds={workspaceTodoIds}
      />
    </section>
    <aside className="hidden overflow-y-auto rounded-lg border bg-card p-3 md:block">
      {!phone && (
        <>
          <h2 className="text-sm font-semibold">{selectedDay ? '这一天' : '任务详情'}</h2>
          {detailBody}
        </>
      )}
    </aside>
    {phone && (selected || selectedDay) && (
      <MobileSheet title={detailTitle} onClose={closeDetail}>
        {detailBody}
      </MobileSheet>
    )}
  </div>
}

function formatDayTitle(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateKey
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
  return `${weekday} ${date.getMonth() + 1}/${date.getDate()}`
}

function formatNoteTime(iso: string) {
  const date = new Date(iso)
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (sameDay) return time
  const day = date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  return `${day} ${time}`
}

function parseStatusChangeTitle(title: string): { from: TodoStatus; to: TodoStatus } | null {
  const match = /^状态变更：(.+?) → (.+)$/.exec(title)
  if (!match) return null
  const labels = Object.entries(TODO_STATUS_LABEL) as [TodoStatus, string][]
  const from = labels.find(([, label]) => label === match[1])?.[0]
  const to = labels.find(([, label]) => label === match[2])?.[0]
  if (!from || !to) return null
  return { from, to }
}

function StatusChangeIcons({ from, to }: { from: TodoStatus; to: TodoStatus }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none">
      <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full py-0.5 pr-1.5 pl-0.5', STATUS_TOKEN[from].bg)}>
        <span className="inline-flex size-4 items-center justify-center">
          <StatusGlyph status={from} className="size-3" />
        </span>
        <span className={STATUS_TOKEN[from].text}>{TODO_STATUS_LABEL[from]}</span>
      </span>
      <ArrowRight className="size-3 shrink-0 text-muted-foreground/70" />
      <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full py-0.5 pr-1.5 pl-0.5', STATUS_TOKEN[to].bg)}>
        <span className="inline-flex size-4 items-center justify-center">
          <StatusGlyph status={to} className="size-3" />
        </span>
        <span className={STATUS_TOKEN[to].text}>{TODO_STATUS_LABEL[to]}</span>
      </span>
    </div>
  )
}

function NoteTimelineRail({
  children,
  last,
}: {
  children: ReactNode
  last?: boolean
}) {
  return (
    <div className="flex w-5 shrink-0 flex-col items-center">
      <div className="relative z-10 flex size-5 items-center justify-center bg-card">
        {children}
      </div>
      {!last && <div className="w-px flex-1 bg-border" />}
    </div>
  )
}

function DetailTitleField({
  value,
  onSave,
}: {
  value: string
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const skipSave = useRef(false)

  useEffect(() => {
    setDraft(value)
  }, [value])

  const commit = () => {
    if (skipSave.current) {
      skipSave.current = false
      setDraft(value)
      return
    }
    const trimmed = draft.trim()
    if (!trimmed) {
      setDraft(value)
      return
    }
    if (trimmed !== value) onSave(trimmed)
  }

  return (
    <Textarea
      id="todo-title"
      rows={1}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          skipSave.current = true
          setDraft(value)
          event.currentTarget.blur()
          return
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
      className="min-h-9 break-words font-medium leading-6"
    />
  )
}

function InlineEdit({
  value,
  multiline = false,
  emptyLabel,
  className,
  inputClassName,
  onSave,
}: {
  value: string
  multiline?: boolean
  emptyLabel?: string
  className?: string
  inputClassName?: string
  onSave: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const skipSave = useRef(false)
  const noHover = useNoHover()

  const commit = () => {
    if (skipSave.current) {
      skipSave.current = false
      setDraft(value)
      setEditing(false)
      return
    }
    setEditing(false)
    onSave(draft)
  }

  const start = () => {
    skipSave.current = false
    setDraft(value)
    setEditing(true)
  }

  if (editing) {
    const fieldProps = {
      value: draft,
      autoFocus: true,
      onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
      onBlur: commit,
      onKeyDown: (event: { key: string; preventDefault: () => void; currentTarget: { blur: () => void } }) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          skipSave.current = true
          setDraft(value)
          setEditing(false)
          return
        }
        if (!multiline && event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      },
      onFocus: (event: { currentTarget: { select: () => void } }) => {
        if (!multiline) event.currentTarget.select()
      },
      className: inputClassName,
    }
    return multiline ? <Textarea rows={4} {...fieldProps} /> : <Input {...fieldProps} />
  }

  return (
    <button
      type="button"
      title={noHover ? '点按编辑' : '双击编辑'}
      onClick={noHover ? start : undefined}
      onDoubleClick={noHover ? undefined : start}
      className={className}
    >
      {value ? value : emptyLabel}
    </button>
  )
}

function TaskDetailPanel({
  selected,
  selectedTodo,
  selectedParent,
  selectedNotes,
  actualMs,
  noteDraft,
  focusNotes,
  onSelectTodo,
  onNoteDraft,
  onFocusNotesHandled,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onPatchTodo,
  onTagsChanged,
}: {
  selected: Detail
  selectedTodo: Todo | null | undefined
  selectedParent: Todo | null | undefined
  selectedNotes: Todo[]
  actualMs: number | null
  noteDraft: string
  focusNotes: boolean
  onSelectTodo: (todo: Todo) => void
  onNoteDraft: (value: string) => void
  onFocusNotesHandled: () => void
  onAddNote: () => Promise<void>
  onUpdateNote: (note: Todo, title: string) => Promise<void>
  onDeleteNote: (note: Todo) => Promise<void>
  onPatchTodo: (todo: Todo, input: TodoPatch) => Promise<void>
  onTagsChanged: () => void
}) {
  const noteInputRef = useRef<HTMLTextAreaElement>(null)
  const [activeWorking, setActiveWorking] = useState<{ id: string; title: string } | null>(null)
  const [workingError, setWorkingError] = useState('')
  const title = selectedTodo?.title ?? selected.title
  const description = selectedTodo?.description ?? selected.description

  useEffect(() => {
    if (!focusNotes) return
    noteInputRef.current?.focus()
    onFocusNotesHandled()
  }, [focusNotes, onFocusNotesHandled])

  useEffect(() => {
    onNoteDraft('')
  }, [selected.todoId, onNoteDraft])

  useEffect(() => {
    if (!selectedTodo) return
    let alive = true
    fetch('/api/aaa/topics', { credentials: 'include' })
      .then((response) => response.json())
      .then((body) => {
        if (alive && body.success) setActiveWorking(body.data.find((topic: { status: string }) => topic.status === 'working') ?? null)
      })
      .catch(() => { if (alive) setWorkingError('Working 信息加载失败') })
    return () => { alive = false }
  }, [selectedTodo?.id])

  return (
    <div className="mt-3">
      {selectedParent && (
        <button
          type="button"
          onClick={() => onSelectTodo(selectedParent)}
          className="mb-3 flex w-full items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-2 py-2 text-left text-xs text-violet-700"
        >
          <CornerUpLeft className="size-3.5 shrink-0" />
          <span className="min-w-0">
            <span className="block text-[9px] text-violet-500">返回父任务</span>
            <span className="block truncate font-medium">{selectedParent.title}</span>
          </span>
        </button>
      )}
      {selectedTodo ? (
        <DetailTitleField
          key={`${selectedTodo.id}-title`}
          value={title}
          onSave={(next) => void onPatchTodo(selectedTodo, { title: next })}
        />
      ) : (
        <p className="break-words font-medium">{title}</p>
      )}
      {selectedTodo && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusPicker status={selectedTodo.status} onChange={(status) => void onPatchTodo(selectedTodo, { status })} />
          <TodoHashtags todo={selectedTodo} onChanged={onTagsChanged} />
        </div>
      )}
      {selectedTodo && selectedTodo.kind !== 'note' && (
        <div className="mt-3 rounded-md border p-2">
          <label htmlFor="detail-active-working" className="text-xs font-medium">关联 Active Working</label>
          <select
            id="detail-active-working"
            className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-xs"
            value={selectedTodo.aaaTopicId ?? ''}
            onChange={(event) => {
              setWorkingError('')
              void onPatchTodo(selectedTodo, { aaaTopicId: event.target.value || null }).catch((cause) => setWorkingError(cause instanceof Error ? cause.message : '关联失败'))
            }}
          >
            <option value="">不关联</option>
            {selectedTodo.aaaTopicId && selectedTodo.aaaTopicId !== activeWorking?.id && <option value={selectedTodo.aaaTopicId}>此前关联的 Working 已结束</option>}
            {activeWorking && <option value={activeWorking.id}>{activeWorking.title}</option>}
          </select>
          {!activeWorking && <p className="mt-1 text-[10px] text-muted-foreground">当前没有 Active Working。</p>}
          {workingError && <p className="mt-1 text-[10px] text-destructive">{workingError}</p>}
        </div>
      )}
      {selected.meta && <p className="mt-2 text-[10px] text-muted-foreground">{selected.meta}</p>}
      {selectedTodo ? (
        <InlineEdit
          key={`${selectedTodo.id}-description`}
          value={description}
          multiline
          emptyLabel="暂无描述"
          className="mt-2 w-full whitespace-pre-wrap text-left text-xs leading-5 text-muted-foreground"
          inputClassName="mt-2 min-h-20 text-xs"
          onSave={(next) => {
            if (next === (selectedTodo.description ?? '')) return
            void onPatchTodo(selectedTodo, { description: next })
          }}
        />
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{description || '暂无描述'}</p>
      )}
      {selectedTodo && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <EstimatedMinutesControl
            minutes={selectedTodo.estimatedMinutes}
            onChange={(estimatedMinutes) => void onPatchTodo(selectedTodo, { estimatedMinutes })}
          />
          {actualMs != null && (
            <p className="text-xs text-muted-foreground">
              实际 <span className="font-medium tabular-nums text-foreground">{formatDuration(actualMs)}</span>
            </p>
          )}
        </div>
      )}

      {selectedTodo && (
        <div className="mt-5 border-t pt-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold">备注</h3>
            <span className="text-[10px] text-muted-foreground">{selectedNotes.length} 条</span>
          </div>
          {selectedNotes.length > 0 ? (
            <div>
              {selectedNotes.map((note, index) => {
                const locked = isStatusChangeNote(note)
                const change = locked ? parseStatusChangeTitle(note.title) : null
                const last = index === selectedNotes.length - 1
                return (
                  <div key={note.id} className="flex min-h-7 gap-2">
                    <NoteTimelineRail>
                      {locked ? (
                        <span
                          className={cn('size-2 rounded-full', STATUS_TOKEN[change?.to ?? 'pending'].solid)}
                          aria-hidden
                        />
                      ) : (
                        <MessageSquare className="size-3.5 text-sky-600 dark:text-sky-400" />
                      )}
                    </NoteTimelineRail>
                    <div className={cn('min-w-0 flex-1', last ? 'pb-2' : 'pb-3')}>
                      {locked ? (
                        <div className="flex min-h-5 items-center gap-2">
                          {change ? (
                            <StatusChangeIcons from={change.from} to={change.to} />
                          ) : (
                            <p className="text-[11px] text-muted-foreground">{note.title}</p>
                          )}
                          <span className="ml-auto shrink-0 text-[9px] tabular-nums text-muted-foreground/80">
                            {formatNoteTime(note.createdAt)}
                          </span>
                        </div>
                      ) : (
                        <div className="rounded-md border bg-background px-2 py-1.5">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="text-[9px] tabular-nums text-muted-foreground">{formatNoteTime(note.createdAt)}</p>
                            <button
                              type="button"
                              aria-label="删除备注"
                              onClick={() => void onDeleteNote(note)}
                              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                          <InlineEdit
                            value={note.title}
                            multiline
                            className="w-full whitespace-pre-wrap text-left text-xs leading-5"
                            inputClassName="min-h-16 text-xs"
                            onSave={(next) => void onUpdateNote(note, next)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="mb-2 text-[10px] text-muted-foreground">暂无备注</p>
          )}
          <div className="flex gap-2">
            {selectedNotes.length > 0 ? (
              <NoteTimelineRail last>
                <Plus className="size-3.5 text-muted-foreground" />
              </NoteTimelineRail>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void onAddNote()
              }}
              className="min-w-0 flex-1 grid gap-1.5"
            >
              <Textarea
                ref={noteInputRef}
                value={noteDraft}
                onChange={(event) => onNoteDraft(event.target.value)}
                placeholder="追加一条备注"
                rows={2}
                className="min-h-16 text-xs"
              />
              <div className="flex justify-end">
                <Button type="submit" size="sm" className="h-7 px-2 text-[10px]" disabled={!noteDraft.trim()}>
                  追加备注
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
