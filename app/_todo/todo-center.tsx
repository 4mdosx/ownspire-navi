'use client'

import { Check, ChevronDown, ChevronLeft, ChevronRight, Circle, GripVertical, Pencil, Play, Plus, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatEstimatedDuration, normalizeEstimatedHours } from '@/backstage/week-plan/week-plan-hours'
import { cn } from '@/lib/utils'
import {
  buildTodoTree,
  hasActivityDragPayload,
  parseActivityDragPayload,
  useTodoStore,
  type ActivityDragPayload,
  type TodoItem,
} from './todo-store'
import { apiUpdateTodo, formatWeekStartClient } from './week-plan-api'
import { shiftWeekStart, formatDateKey } from '@/backstage/week-plan/week-utils'
import {
  TODO_KIND_LABEL,
  TODO_STATUS_LABEL,
  hasTimeLink,
  isScheduledTodo,
  weekStartOf,
  type Todo,
  type TodoKind,
} from '@/types/todo'
import type { ExecutionActivity } from '@/types/execution'
import { TodoActivityView } from './todo-activity-view'
import { TodoTimelineCalendar } from './todo-timeline-calendar'
import { TodayExecutionCenter } from './today-execution-center'
import { AppToolbar, type WorkspaceViewId } from './app-toolbar'
import { MobileSheet, MobileTabBar } from './mobile-chrome'
import { closePhonePanel, openPhonePanel } from './phone-panel'
import { usePhoneLayout } from './use-phone-layout'
import { TagWorkspaceProvider } from './tag-workspace'
import { StatusGlyph } from './todo-status'

function getSundayOfWeekContaining(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

function getYearWeekLabel(date: Date): string {
  const year = date.getFullYear()
  const weekStart = getSundayOfWeekContaining(date)
  const firstWeekStart = getSundayOfWeekContaining(new Date(year, 0, 1))
  const diffDays = Math.floor(
    (weekStart.getTime() - firstWeekStart.getTime()) / 86400000
  )
  const week = Math.floor(diffDays / 7) + 1
  return `${year}年 第${week}周`
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

const TIME_FILTER_LABELS = {
  all: '全部时间',
  backlog: '待安排',
  scheduled: '已安排',
} as const

function DeleteConfirmButton({
  onConfirm,
  size = 'md',
  label = '删除',
}: {
  onConfirm: () => void
  size?: 'sm' | 'md'
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        className={cn(
          'flex items-center justify-center rounded-md text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400',
          size === 'sm' ? 'size-6' : 'size-7'
        )}
      >
        <Trash2 className={size === 'sm' ? 'size-3' : 'size-3.5'} />
      </button>
      {open ? (
        <div
          role="tooltip"
          className="absolute bottom-full right-0 z-50 mb-1.5 w-max rounded-md border border-neutral-200 bg-white px-3 py-2 text-neutral-900 shadow-md dark:border-neutral-200"
        >
          <p className="mb-2 text-xs text-neutral-800">确认删除此任务？</p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="rounded-md bg-destructive px-2 py-1 text-[10px] font-medium text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
                onConfirm()
              }}
            >
              确认删除
            </button>
            <button
              type="button"
              className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] font-medium text-neutral-700 hover:bg-neutral-50"
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
              }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

type WeekDayTab = {
  dayIndex: number
  date: Date
  label: string
  isToday: boolean
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function getVisibleWeekDayTabs(anchor: Date): WeekDayTab[] {
  const sunday = getSundayOfWeekContaining(anchor)
  const today = startOfLocalDay(new Date())
  const weekSunday = startOfLocalDay(sunday)
  const weekSaturday = new Date(weekSunday)
  weekSaturday.setDate(weekSunday.getDate() + 6)

  const isPastWeek = weekSaturday < today
  const isFutureWeek = weekSunday > today
  const tabs: WeekDayTab[] = []

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const date = new Date(sunday)
    date.setDate(sunday.getDate() + dayIndex)
    const dayStart = startOfLocalDay(date)
    if (!isPastWeek && !isFutureWeek && dayStart > today) break

    const isToday = dayStart.getTime() === today.getTime()
    const md = `${date.getMonth() + 1}/${date.getDate()}`
    tabs.push({
      dayIndex,
      date,
      label: isToday ? `今天 ${md}` : `${WEEKDAY_LABELS[dayIndex]} ${md}`,
      isToday,
    })
  }
  return tabs
}

function DayTabBar({
  tabs,
  activeDayIndex,
  onActiveDayChange,
}: {
  tabs: WeekDayTab[]
  activeDayIndex: number
  onActiveDayChange: (dayIndex: number) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="每日待办日期">
      {tabs.map((tab) => {
        const isActive = tab.dayIndex === activeDayIndex
        return (
          <button
            key={tab.dayIndex}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onActiveDayChange(tab.dayIndex)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
              isActive &&
                tab.isToday &&
                'border-emerald-300/80 bg-emerald-50/80 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-100',
              isActive &&
                !tab.isToday &&
                'border-neutral-200 bg-white text-neutral-900 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100',
              !isActive &&
                'border-transparent text-neutral-500 hover:border-neutral-200 hover:bg-white hover:text-neutral-900 dark:hover:border-neutral-800 dark:hover:bg-neutral-950 dark:hover:text-neutral-100'
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function TodoRow({
  item,
  now,
  depth = 0,
  hasChildren = false,
  subtaskProgress,
  onStart,
  onComplete,
  onRemove,
  onEdit,
}: {
  item: TodoItem
  now: number
  depth?: number
  hasChildren?: boolean
  subtaskProgress?: { done: number; total: number }
  onStart: () => void
  onComplete: () => void
  onRemove: () => void
  onEdit: () => void
}) {
  const setDraggingPayload = useTodoStore((s) => s.setDraggingPayload)
  const isActive = item.status === 'active'
  const isDone = item.status === 'done'
  const isClosed = isDone || item.status === 'cancelled'
  const elapsed =
    isActive && item.startedAtMs != null ? formatElapsed(now - item.startedAtMs) : null
  const canDrag = !hasChildren

  const onDragStart = (e: React.DragEvent) => {
    if (!canDrag) return
    const payloadObj = {
      kind: 'week-activity',
      source: 'todo',
      id: item.id,
      title: item.title,
      day: item.estimatedHours,
    } satisfies ActivityDragPayload
    const payload = JSON.stringify(payloadObj)
    setDraggingPayload(payloadObj)
    e.dataTransfer.setData('application/json', payload)
    e.dataTransfer.setData('text/plain', payload)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <li
      draggable={canDrag}
      onDragStart={onDragStart}
      onDragEnd={() => setDraggingPayload(null)}
      className={cn(
        'group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
        depth > 0 && 'ml-6 border-dashed',
        canDrag && 'cursor-grab active:cursor-grabbing',
        isActive &&
          'border-emerald-300/80 bg-emerald-50/80 dark:border-emerald-700/60 dark:bg-emerald-950/30',
        !isActive &&
          !isDone &&
          'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950',
        isDone && 'border-neutral-100 bg-neutral-50/80 opacity-60 dark:border-neutral-800/60 dark:bg-neutral-900/40'
      )}
    >
      <button
        type="button"
        onClick={isClosed || hasChildren ? undefined : onComplete}
        disabled={isClosed || hasChildren}
        aria-label={isDone ? '已完成' : hasChildren ? '父任务' : '标记完成'}
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors',
          isDone
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : hasChildren
              ? 'border-neutral-200 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800'
              : 'border-neutral-300 text-neutral-400 hover:border-emerald-500 hover:text-emerald-600 dark:border-neutral-600 dark:hover:border-emerald-500'
        )}
      >
        {isDone ? <Check className="size-3.5" /> : <Circle className="size-3.5" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'truncate text-sm font-medium',
              isDone && 'line-through text-neutral-500',
              depth > 0 && 'text-neutral-700 dark:text-neutral-300'
            )}
          >
            {item.title}
          </span>
          {isActive && (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              进行中
            </span>
          )}
          {item.status === 'blocked' && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">阻塞</span>
          )}
          {item.status === 'cancelled' && (
            <span className="shrink-0 rounded-full bg-neutral-500/15 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:text-neutral-300">已取消</span>
          )}
          {hasChildren && subtaskProgress && (
            <span className="shrink-0 text-[10px] text-neutral-500">
              {subtaskProgress.done}/{subtaskProgress.total} 完成
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-neutral-500">
          预计 {formatEstimatedDuration(item.estimatedHours)}
          {elapsed != null && (
            <span className="ml-2 tabular-nums text-emerald-700 dark:text-emerald-400">
              · {elapsed}
            </span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={onEdit}
          aria-label="编辑任务"
          className="flex size-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <Pencil className="size-3.5" />
        </button>
        {!isClosed && !isActive && !hasChildren && (
          <button
            type="button"
            onClick={onStart}
            aria-label="开始"
            className="flex size-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <Play className="size-3.5" />
          </button>
        )}
        <DeleteConfirmButton onConfirm={onRemove} />
      </div>
    </li>
  )
}

type DraftSubtask = {
  id: string
  parentId: string
  title: string
  estimatedHours: string
}

const DRAFT_PARENT_ID = 'parent-draft'

function createDraftSubtask(): DraftSubtask {
  return {
    id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    parentId: DRAFT_PARENT_ID,
    title: '',
    estimatedHours: '0.5',
  }
}

function TodoRowGroup({
  item,
  now,
  depth = 0,
  onStart,
  onComplete,
  onRemove,
  onEdit,
}: {
  item: TodoItem
  now: number
  depth?: number
  onStart: (id: string) => void
  onComplete: (id: string) => void
  onRemove: (id: string) => void
  onEdit: (item: TodoItem) => void
}) {
  const children = item.subtasks ?? []
  const hasChildren = children.length > 0
  const doneCount = children.filter((s) => s.status === 'done').length

  return (
    <>
      <TodoRow
        item={item}
        now={now}
        depth={depth}
        hasChildren={hasChildren}
        subtaskProgress={hasChildren ? { done: doneCount, total: children.length } : undefined}
        onStart={() => onStart(item.id)}
        onComplete={() => onComplete(item.id)}
        onRemove={() => onRemove(item.id)}
        onEdit={() => onEdit(item)}
      />
      {children.map((sub) => (
        <TodoRowGroup
          key={sub.id}
          item={sub}
          now={now}
          depth={depth + 1}
          onStart={onStart}
          onComplete={onComplete}
          onRemove={onRemove}
          onEdit={onEdit}
        />
      ))}
    </>
  )
}

type TodoDetailFields = {
  id: string
  title: string
  description: string
  content: string
  status: TodoItem['status']
  version: number
  kind?: TodoKind
  aaaTopicId?: string | null
}

type AaaTopicOption = { id: string; title: string; status: string }

function useActiveWorking(open: boolean) {
  const [topics, setTopics] = useState<AaaTopicOption[]>([])
  useEffect(() => {
    if (!open) return
    let alive = true
    fetch('/api/aaa/topics').then((res) => res.json()).then((body) => {
      if (alive && body.success && Array.isArray(body.data)) setTopics(body.data.filter((topic: AaaTopicOption) => topic.status === 'working'))
    }).catch(() => {})
    return () => { alive = false }
  }, [open])
  return topics
}

function TodoDetailDialog({
  item,
  open,
  onOpenChange,
  updateTodo,
  addSubtask,
  onDelete,
  initialMode = 'edit',
}: {
  item: TodoDetailFields | null
  open: boolean
  onOpenChange: (open: boolean) => void
  updateTodo: ReturnType<typeof useTodoStore.getState>['updateTodo']
  addSubtask?: ReturnType<typeof useTodoStore.getState>['addSubtask']
  onDelete?: (id: string) => Promise<void>
  initialMode?: 'view' | 'edit'
}) {
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<TodoItem['status']>('pending')
  const [kind, setKind] = useState<TodoKind>('action')
  const [aaaTopicId, setAaaTopicId] = useState<string | null>(null)
  const activeWorkings = useActiveWorking(open)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!item || !open) return
    setTitle(item.title)
    setDescription(item.description)
    setContent(item.content)
    setStatus(item.status)
    setKind(item.kind ?? 'action')
    setAaaTopicId(item.aaaTopicId ?? null)
    setSubtaskTitle('')
    setError(null)
    setConfirmDelete(false)
    setMode(initialMode)
  }, [item, open, initialMode])

  const save = async () => {
    if (!item || !title.trim()) return
    setSaving(true)
    setError(null)
    try {
      await updateTodo(item.id, {
        title: title.trim(), description, content, status, kind, aaaTopicId,
        version: item.version,
      })
      setMode('view')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重新打开任务后再试')
    } finally {
      setSaving(false)
    }
  }

  const createChild = async () => {
    if (!item || !addSubtask || !subtaskTitle.trim()) return
    setSaving(true)
    setError(null)
    try {
      await addSubtask(item.id, { title: subtaskTitle.trim() })
      setSubtaskTitle('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '子任务创建失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!item || !onDelete) return
    setDeleting(true)
    setError(null)
    try {
      await onDelete(item.id)
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请稍后重试')
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const viewing = mode === 'view'
  const busy = saving || deleting

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
        overlayClassName="bg-neutral-500/15 backdrop-blur-[2px]"
      >
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <div>
              <DialogTitle>{viewing ? '任务详情' : '编辑任务'}</DialogTitle>
              <DialogDescription>
                {viewing ? '查看完整定义与执行状态，可切换到编辑。' : '修改后保存到统一 Todo 域。'}
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={busy}
              onClick={() => {
                if (!viewing && item) {
                  setTitle(item.title)
                  setDescription(item.description)
                  setContent(item.content)
                  setStatus(item.status)
                  setKind(item.kind ?? 'action')
                  setAaaTopicId(item.aaaTopicId ?? null)
                  setError(null)
                }
                setConfirmDelete(false)
                setMode(viewing ? 'edit' : 'view')
              }}
            >
              {viewing ? '编辑' : '查看'}
            </Button>
          </div>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="todo-title">标题</Label>
            <Textarea
              id="todo-title"
              rows={1}
              value={title}
              readOnly={viewing}
              onChange={viewing ? undefined : (event) => setTitle(event.target.value)}
              className={cn('min-h-9 break-words', viewing && 'bg-muted/40')}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="todo-description">描述与验收标准</Label>
            {viewing ? (
              <p className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {description || '暂无描述'}
              </p>
            ) : (
              <Textarea id="todo-description" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明目标、范围和完成标准" />
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="todo-content">执行状态</Label>
            {viewing ? (
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                {content || '暂无执行记录'}
              </pre>
            ) : (
              <>
                <Textarea id="todo-content" rows={8} value={content} onChange={(event) => setContent(event.target.value)} placeholder="记录当前进度、关键发现、下一步和阻塞项" className="font-mono text-xs" />
                <p className="text-xs text-neutral-500">该内容也可由 Codex 通过 MCP 持续更新。</p>
              </>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="todo-status">状态</Label>
            {viewing ? (
              <p className="text-sm">{TODO_STATUS_LABEL[status]}</p>
            ) : (
              <select id="todo-status" value={status} onChange={(event) => setStatus(event.target.value as TodoItem['status'])} className="h-10 rounded-md border border-neutral-200 bg-background px-3 text-sm dark:border-neutral-800">
                <option value="pending">待办</option>
                <option value="active">进行中</option>
                <option value="blocked">冻结</option>
                <option value="done">完成</option>
                <option value="cancelled">放弃</option>
              </select>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="todo-kind">任务类型</Label>
            {viewing ? (
              <p className="text-sm">{TODO_KIND_LABEL[kind]}</p>
            ) : (
              <select id="todo-kind" value={kind} onChange={(event) => setKind(event.target.value as TodoKind)} className="h-10 rounded-md border border-neutral-200 bg-background px-3 text-sm dark:border-neutral-800">
                {Object.entries(TODO_KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="todo-aaa-topic">Active Working</Label>
            {viewing ? (
              <p className="text-sm">{activeWorkings.find((topic) => topic.id === aaaTopicId)?.title ?? (aaaTopicId ? '此前关联的 Working 已结束' : '未关联')}</p>
            ) : (
              <select id="todo-aaa-topic" value={aaaTopicId ?? ''} onChange={(event) => setAaaTopicId(event.target.value || null)} className="h-10 rounded-md border border-neutral-200 bg-background px-3 text-sm dark:border-neutral-800">
                <option value="">不关联</option>
                {aaaTopicId && !activeWorkings.some((topic) => topic.id === aaaTopicId) && <option value={aaaTopicId}>此前关联的 Working 已结束</option>}
                {activeWorkings.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
              </select>
            )}
          </div>
          {!viewing && addSubtask && (
            <div className="grid gap-1.5 rounded-lg border border-dashed p-3 dark:border-neutral-800">
              <Label htmlFor="todo-subtask">添加子任务</Label>
              <div className="flex gap-2">
                <Input id="todo-subtask" value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="输入子任务标题" />
                <Button type="button" variant="outline" disabled={busy || !subtaskTitle.trim()} onClick={() => void createChild()}>添加</Button>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {onDelete && (
              confirmDelete ? (
                <>
                  <span className="text-xs text-muted-foreground">确认删除此任务？</span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleDelete()}
                  >
                    {deleting ? '删除中…' : '确认删除'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                  >
                    取消
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="mr-1 size-3.5" />
                  删除任务
                </Button>
              )
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              {viewing ? '关闭' : '取消'}
            </Button>
            {!viewing && (
              <Button type="button" disabled={busy || !title.trim()} onClick={() => void save()}>
                {saving ? '保存中…' : '保存'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddTodoDialog({
  open,
  onOpenChange,
  dayLabel,
  onSubmitTree,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dayLabel: string
  onSubmitTree: (input: {
    parent?: { title: string; aaaTopicId?: string | null }
    subtasks?: Array<{ title: string; estimatedHours: number }>
    root?: { title: string; estimatedHours: number; aaaTopicId?: string | null }
  }) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [estimatedHours, setEstimatedHours] = useState('1')
  const [parentTitle, setParentTitle] = useState('')
  const [subtasks, setSubtasks] = useState<DraftSubtask[]>([])
  const [treeMode, setTreeMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const reset = useCallback(() => {
    setTitle('')
    setEstimatedHours('1')
    setParentTitle('')
    setSubtasks([])
    setTreeMode(false)
    setSubmitting(false)
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset()
      onOpenChange(next)
    },
    [onOpenChange, reset]
  )

  const enterTreeMode = useCallback(() => {
    setTreeMode(true)
    setParentTitle((prev) => prev.trim() || title.trim())
    setTitle('')
    setEstimatedHours('1')
    setSubtasks((prev) => (prev.length > 0 ? prev : [createDraftSubtask()]))
  }, [title])

  const addSubtask = useCallback(() => {
    if (!treeMode) {
      enterTreeMode()
      return
    }
    setSubtasks((prev) => [...prev, createDraftSubtask()])
  }, [enterTreeMode, treeMode])

  const removeSubtask = useCallback((index: number) => {
    setSubtasks((prev) => {
      const next = prev.filter((_, i) => i !== index)
      if (next.length === 0) {
        setTreeMode(false)
        setParentTitle((parent) => {
          const p = parent.trim()
          if (p) setTitle((t) => t.trim() || p)
          return ''
        })
      }
      return next
    })
  }, [])

  const exitTreeMode = useCallback(() => {
    setTreeMode(false)
    setSubtasks([])
    setParentTitle((parent) => {
      const p = parent.trim()
      if (p) setTitle((t) => t.trim() || p)
      return ''
    })
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (submitting) return
      setSubmitting(true)
      try {
        if (treeMode && subtasks.length > 0) {
          const trimmedParent = parentTitle.trim()
          if (!trimmedParent) return
          const validSubs = subtasks
            .map((s) => ({
              title: s.title.trim(),
              estimatedHours: normalizeEstimatedHours(Number(s.estimatedHours) || 0.5),
            }))
            .filter((s) => s.title)
          if (validSubs.length === 0) return
          await onSubmitTree({ parent: { title: trimmedParent }, subtasks: validSubs })
        } else {
          const trimmed = title.trim()
          if (!trimmed) return
          await onSubmitTree({
            root: {
              title: trimmed,
              estimatedHours: normalizeEstimatedHours(Number(estimatedHours) || 1),
            },
          })
        }
        handleOpenChange(false)
      } finally {
        setSubmitting(false)
      }
    },
    [
      treeMode,
      subtasks,
      parentTitle,
      title,
      estimatedHours,
      onSubmitTree,
      handleOpenChange,
      submitting,
    ]
  )

  const parentTotalHours = subtasks.reduce(
    (sum, s) => sum + normalizeEstimatedHours(Number(s.estimatedHours) || 0.5),
    0
  )

  const canSubmit =
    treeMode && subtasks.length > 0
      ? parentTitle.trim().length > 0 && subtasks.some((s) => s.title.trim())
      : title.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        overlayClassName="bg-neutral-500/15 backdrop-blur-[2px] duration-300 ease-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        className={cn(
          'sm:max-w-[440px] duration-300 ease-out',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[state=open]:slide-in-from-left-1/2 data-[state=closed]:slide-out-to-left-1/2',
          'data-[state=open]:slide-in-from-top-[48%] data-[state=closed]:slide-out-to-top-[48%]'
        )}
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>新增任务</DialogTitle>
            <DialogDescription>添加到 {dayLabel} 的待办列表</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {treeMode ? (
              <div className="grid gap-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="grid gap-2">
                  <Label htmlFor="todo-parent-title">父任务</Label>
                  <Input
                    id="todo-parent-title"
                    value={parentTitle}
                    onChange={(e) => setParentTitle(e.target.value)}
                    placeholder="父任务标题"
                  />
                  {subtasks.length > 0 && (
                    <p className="text-xs text-neutral-500">
                      总预计 {formatEstimatedDuration(parentTotalHours)}（子任务合计）
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>子任务</Label>
                    <button
                      type="button"
                      onClick={addSubtask}
                      className="flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                    >
                      <Plus className="size-3.5" />
                      添加子任务
                    </button>
                  </div>
                  {subtasks.length === 0 ? (
                    <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-neutral-400">
                      暂无子任务，点击上方添加
                    </p>
                  ) : (
                    subtasks.map((sub, index) => (
                      <div
                        key={sub.id}
                        className="grid gap-2 rounded-md border border-dashed p-2"
                      >
                        <div className="flex items-start gap-2">
                          <Input
                            value={sub.title}
                            onChange={(e) =>
                              setSubtasks((prev) =>
                                prev.map((s, i) =>
                                  i === index ? { ...s, title: e.target.value } : s
                                )
                              )
                            }
                            placeholder={`子任务 ${index + 1}`}
                            className="text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => removeSubtask(index)}
                            aria-label="移除子任务"
                            className="flex size-9 shrink-0 items-center justify-center rounded-md text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`sub-hours-${sub.id}`} className="shrink-0 text-xs">
                            时长（小时）
                          </Label>
                          <Input
                            id={`sub-hours-${sub.id}`}
                            type="number"
                            min={0.5}
                            step={0.5}
                            value={sub.estimatedHours}
                            onChange={(e) =>
                              setSubtasks((prev) =>
                                prev.map((s, i) =>
                                  i === index ? { ...s, estimatedHours: e.target.value } : s
                                )
                              )
                            }
                            className="h-8 w-24 text-sm"
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  onClick={exitTreeMode}
                  className="text-left text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                >
                  改为单条任务
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="todo-title">标题</Label>
                  <Input
                    id="todo-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="输入任务名称"
                    autoFocus
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="todo-hours">预计时长（小时）</Label>
                  <Input
                    id="todo-hours"
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={estimatedHours}
                    onChange={(e) => setEstimatedHours(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  onClick={enterTreeMode}
                  className="flex w-fit items-center gap-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  <Plus className="size-3.5" />
                  拆解为子任务
                </button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting
                ? '添加中…'
                : treeMode && subtasks.some((s) => s.title.trim())
                  ? '添加全部'
                  : '添加'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TodoList({
  todos,
  now,
  weekAnchor,
  activeDayIndex,
  onActiveDayChange,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  actions,
}: {
  todos: TodoItem[]
  now: number
  weekAnchor: Date
  activeDayIndex: number
  onActiveDayChange: (dayIndex: number) => void
  isDragOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  actions: Pick<ReturnType<typeof useTodoStore.getState>, 'startTodo' | 'completeTodo' | 'removeTodo' | 'addTodoTree' | 'updateTodo' | 'addSubtask'>
}) {
  const { startTodo, completeTodo, removeTodo, addTodoTree, updateTodo, addSubtask } = actions
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editingTodo, setEditingTodo] = useState<TodoItem | null>(null)

  useEffect(() => {
    setEditingTodo((current) => {
      if (!current) return current
      return todos.find((todo) => todo.id === current.id) ?? current
    })
  }, [todos])

  const dayTabs = useMemo(() => getVisibleWeekDayTabs(weekAnchor), [weekAnchor])
  const activeDayLabel =
    dayTabs.find((t) => t.dayIndex === activeDayIndex)?.label ?? '当日'

  const handleAddTodoTree = useCallback(
    (input: {
      parent?: { title: string; aaaTopicId?: string | null }
      subtasks?: Array<{ title: string; estimatedHours: number }>
      root?: { title: string; estimatedHours: number; aaaTopicId?: string | null }
    }) => addTodoTree({ ...input, dayIndex: activeDayIndex }),
    [activeDayIndex, addTodoTree]
  )

  const dayTodos = useMemo(
    () => todos.filter((t) => t.dayIndex === activeDayIndex),
    [todos, activeDayIndex]
  )

  const todoTree = useMemo(() => buildTodoTree(dayTodos), [dayTodos])

  const sorted = useMemo(() => {
    const order = { active: 0, blocked: 1, pending: 2, done: 3, cancelled: 4 } as const
    const rootStatus = (item: TodoItem) => {
      const children = item.subtasks ?? []
      if (children.length === 0) return item.status
      if (children.some((c) => c.status === 'active')) return 'active' as const
      if (children.every((c) => c.status === 'done')) return 'done' as const
      return 'pending' as const
    }
    return [...todoTree].sort((a, b) => order[rootStatus(a)] - order[rootStatus(b)])
  }, [todoTree])

  const activeCount = dayTodos.filter(
    (t) => t.status === 'active' && t.parentId != null
  ).length
  const doneCount = dayTodos.filter(
    (t) => t.status === 'done' && t.parentId != null
  ).length
  const rootDoneCount = todoTree.filter((t) => {
    const children = t.subtasks ?? []
    if (children.length === 0) return t.status === 'done'
    return children.every((c) => c.status === 'done')
  }).length

  return (
    <>
      <AddTodoDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        dayLabel={activeDayLabel}
        onSubmitTree={handleAddTodoTree}
      />
      <TodoDetailDialog
        item={editingTodo}
        open={editingTodo != null}
        onOpenChange={(open) => { if (!open) setEditingTodo(null) }}
        updateTodo={updateTodo}
        addSubtask={addSubtask}
        onDelete={async (id) => { await removeTodo(id) }}
        initialMode="edit"
      />
      <div
        className={cn(
          'flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border transition-colors',
          isDragOver
            ? 'border-dashed border-emerald-400 bg-emerald-50/50 dark:border-emerald-600 dark:bg-emerald-950/20'
            : 'border-neutral-200 bg-neutral-50/50 dark:border-neutral-800 dark:bg-neutral-900/30'
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
      <div className="flex shrink-0 flex-col gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500">
            {activeCount > 0 ? `${activeCount} 项进行中` : `${dayTodos.length} 项任务`}
            {doneCount > 0 && ` · 已完成 ${rootDoneCount}`}
          </p>
          <button
            type="button"
            onClick={() => setAddDialogOpen(true)}
            className="flex shrink-0 items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-900"
          >
            <Plus className="size-3.5" />
            添加
          </button>
        </div>

        <DayTabBar
          tabs={dayTabs}
          activeDayIndex={activeDayIndex}
          onActiveDayChange={onActiveDayChange}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {sorted.length === 0 ? (
          <div
            className={cn(
              'flex h-full min-h-48 flex-col items-center justify-center rounded-md border border-dashed px-6 text-center',
              isDragOver
                ? 'border-emerald-400 text-emerald-700 dark:text-emerald-300'
                : 'border-neutral-200 text-neutral-400 dark:border-neutral-700'
            )}
          >
            <p className="text-sm font-medium">拖入活动或点击添加</p>
            <p className="mt-1 text-xs">拖入后自动开始计时；手动添加需点击开始</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((item) => (
              <TodoRowGroup
                key={item.id}
                item={item}
                now={now}
                onStart={startTodo}
                onComplete={completeTodo}
                onRemove={removeTodo}
                onEdit={setEditingTodo}
              />
            ))}
          </ul>
        )}
      </div>
      </div>
    </>
  )
}

function WorkspaceTodoRow({
  todo,
  expanded,
  onToggleExpand,
  onOpenDetail,
  onRemove,
}: {
  todo: Todo
  expanded: boolean
  onToggleExpand: () => void
  onOpenDetail: () => void
  onRemove: () => void
}) {
  const setDraggingPayload = useTodoStore((s) => s.setDraggingPayload)
  const isBacklog = !isScheduledTodo(todo)
  const hasBody = Boolean(todo.description.trim() || todo.content.trim())

  const onDragStart = (e: React.DragEvent) => {
    const payloadObj = {
      kind: 'week-activity',
      source: 'pending',
      id: todo.id,
      title: todo.title,
      day: Math.max(1, Math.round(todo.estimatedMinutes / 60) || 1),
    } satisfies ActivityDragPayload
    const payload = JSON.stringify(payloadObj)
    setDraggingPayload(payloadObj)
    e.dataTransfer.setData('application/json', payload)
    e.dataTransfer.setData('text/plain', payload)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => setDraggingPayload(null)}
      className={cn(
        'cursor-grab rounded-md border bg-background text-xs transition-colors active:cursor-grabbing',
        todo.status === 'cancelled' && 'opacity-70'
      )}
    >
      <div className="flex items-start gap-1.5 px-2 py-2">
        <span className="mt-0.5 text-muted-foreground" aria-hidden>
          <GripVertical className="size-3.5" />
        </span>
        <button
          type="button"
          onClick={onOpenDetail}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-start justify-between gap-2">
            <span className={cn('font-medium', todo.status === 'cancelled' && 'line-through')}>
              {todo.title}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {TODO_STATUS_LABEL[todo.status]}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className={cn(
              'rounded px-1 py-0.5',
              isBacklog ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
            )}>
              {isBacklog ? '待安排' : '已安排'}
            </span>
            <span className="rounded bg-violet-500/10 px-1 py-0.5 text-violet-700 dark:text-violet-300">
              {TODO_KIND_LABEL[todo.kind]}
            </span>
            <span>预计 {formatEstimatedDuration(todo.estimatedMinutes / 60)}</span>
            {weekStartOf(todo) && <span>· {weekStartOf(todo)}</span>}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {hasBody && (
            <button
              type="button"
              onClick={onToggleExpand}
              aria-expanded={expanded}
              aria-label={expanded ? '收起内容' : '展开内容'}
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
            </button>
          )}
          <DeleteConfirmButton size="sm" onConfirm={onRemove} />
        </div>
      </div>
      {expanded && hasBody && (
        <div className="space-y-2 border-t px-2.5 py-2 text-[11px] text-muted-foreground">
          {todo.description.trim() && (
            <div>
              <p className="mb-0.5 font-medium text-foreground/80">描述</p>
              <p className="whitespace-pre-wrap">{todo.description}</p>
            </div>
          )}
          {todo.content.trim() && (
            <div>
              <p className="mb-0.5 font-medium text-foreground/80">执行状态</p>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[10px]">{todo.content}</pre>
            </div>
          )}
          <button type="button" onClick={onOpenDetail} className="text-[10px] text-primary hover:underline">
            打开详情
          </button>
        </div>
      )}
    </li>
  )
}

function TodoWorkspacePanel({
  todos,
  dragProps,
  actions,
  updateTodo,
  onTodoSaved,
  overview = false,
}: {
  todos: Todo[]
  dragProps: {
    isDragOver: boolean
    onDragOver: (event: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (event: React.DragEvent) => void
  }
  actions: Pick<ReturnType<typeof useTodoStore.getState>, 'addPending' | 'removePending' | 'removeTodo'>
  updateTodo: ReturnType<typeof useTodoStore.getState>['updateTodo']
  onTodoSaved: () => void
  overview?: boolean
}) {
  const { addPending, removePending, removeTodo } = actions
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Todo['status'] | 'all'>('all')
  const [timeFilter, setTimeFilter] = useState<'all' | 'backlog' | 'scheduled'>('all')
  const [kind, setKind] = useState<'all' | TodoKind>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [hours, setHours] = useState('1')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [detailTodo, setDetailTodo] = useState<Todo | null>(null)

  useEffect(() => {
    setDetailTodo((current) => {
      if (!current) return current
      return todos.find((todo) => todo.id === current.id) ?? current
    })
  }, [todos])

  const backlogCount = useMemo(
    () => todos.filter((todo) => !isScheduledTodo(todo)).length,
    [todos]
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return todos
      .filter((todo) => {
        if (timeFilter === 'backlog' && isScheduledTodo(todo)) return false
        if (timeFilter === 'scheduled' && !isScheduledTodo(todo)) return false
        if (status !== 'all' && todo.status !== status) return false
        if (kind !== 'all' && todo.kind !== kind) return false
        return !needle || `${todo.title}\n${todo.description}\n${todo.content}`.toLowerCase().includes(needle)
      })
      .sort((a, b) => {
        const aScheduled = isScheduledTodo(a)
        const bScheduled = isScheduledTodo(b)
        if (aScheduled !== bScheduled) return aScheduled ? 1 : -1
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      })
  }, [todos, query, status, timeFilter, kind])

  const overviewGroups = useMemo(() => {
    const today = new Date()
    const currentWeekStart = formatWeekStartClient(today)
    const todayKey = formatDateKey(today)
    const current = filtered.filter((todo) =>
      todo.status === 'active' ||
      (hasTimeLink(todo, 'day', todayKey) && todo.status !== 'done')
    )
    const currentIds = new Set(current.map((todo) => todo.id))
    const week = filtered.filter((todo) =>
      !currentIds.has(todo.id) && hasTimeLink(todo, 'week', currentWeekStart) && todo.status !== 'done'
    )
    const weekIds = new Set(week.map((todo) => todo.id))
    const waiting = filtered.filter((todo) =>
      !currentIds.has(todo.id) && !weekIds.has(todo.id) && todo.status === 'blocked'
    )
    const waitingIds = new Set(waiting.map((todo) => todo.id))
    const later = filtered.filter((todo) => !currentIds.has(todo.id) && !weekIds.has(todo.id) && !waitingIds.has(todo.id))
    return [
      { key: 'current', title: '当前焦点', hint: '今天真正需要关注', todos: current },
      { key: 'week', title: '本周计划', hint: '本周其他已安排事项', todos: week },
      { key: 'waiting', title: '等待启动', hint: '被冻结、需要解除阻塞', todos: waiting },
      { key: 'later', title: '长期与以后', hint: '可靠保存，暂不占用注意力', todos: later },
    ]
  }, [filtered])

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    void addPending({
      title: trimmed,
      estimatedHours: Math.max(1, Math.round(Number(hours) || 1)),
    }).then(() => {
      setTitle('')
      setHours('1')
      setAddOpen(false)
    })
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const saveDetail = async (
    id: string,
    input: {
      title?: string
      description?: string
      content?: string
      status?: Todo['status']
      version: number
    }
  ) => {
    await updateTodo(id, input)
    onTodoSaved()
  }

  return (
    <aside
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden bg-card p-3 transition-colors',
        overview ? 'h-[82vh]' : 'h-[calc(100svh-7rem)] rounded-lg border xl:h-full',
        dragProps.isDragOver && 'border-dashed border-amber-400 bg-amber-50/80 dark:border-amber-600 dark:bg-amber-950/20'
      )}
      aria-label="Todo 工作区"
      onDragOver={dragProps.onDragOver}
      onDragLeave={dragProps.onDragLeave}
      onDrop={dragProps.onDrop}
    >
      <TodoDetailDialog
        item={detailTodo}
        open={detailTodo != null}
        onOpenChange={(open) => { if (!open) setDetailTodo(null) }}
        updateTodo={saveDetail}
        onDelete={async (id) => {
          const target = todos.find((todo) => todo.id === id)
          if (target && !isScheduledTodo(target)) await removePending(id)
          else await removeTodo(id)
          onTodoSaved()
        }}
        initialMode="view"
      />

      <div className="mb-3 flex shrink-0 items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">任务地图</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            按注意力阶段查看全部任务；拖到周计划即可安排执行。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen((value) => !value)}
          className="flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium shadow-sm hover:bg-muted"
        >
          <Plus className="size-3.5" />
          添加
        </button>
      </div>

      {addOpen && (
        <form onSubmit={handleAdd} className="mb-3 flex shrink-0 flex-col gap-2 rounded-md border border-dashed p-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="活动名称"
            className="h-8 text-xs"
            autoFocus
          />
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="h-8 w-20 text-xs"
              aria-label="预计小时"
            />
            <Button type="submit" size="sm" className="h-8 text-xs" disabled={!title.trim()}>
              保存到待安排
            </Button>
          </div>
        </form>
      )}

      <div className="mb-2 flex shrink-0 flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、描述或进度"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <select
            value={timeFilter}
            onChange={(event) => setTimeFilter(event.target.value as 'all' | 'backlog' | 'scheduled')}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            {Object.entries(TIME_FILTER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select value={kind} onChange={(event) => setKind(event.target.value as 'all' | TodoKind)} className="h-8 rounded-md border bg-background px-2 text-xs">
            <option value="all">全部类型</option>
            {Object.entries(TODO_KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as Todo['status'] | 'all')}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            <option value="all">全部状态</option>
            {Object.entries(TODO_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {filtered.length} / {todos.length} 项 · 待安排 {backlogCount}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto overscroll-contain lg:grid-cols-2 2xl:grid-cols-4">
        {overviewGroups.map((group) => (
          <section key={group.key} className="min-w-0 rounded-lg border bg-muted/20 p-2">
            <div className="mb-2">
              <h3 className="text-xs font-semibold">{group.title} · {group.todos.length}</h3>
              <p className="text-[10px] text-muted-foreground">{group.hint}</p>
            </div>
            <ul className="space-y-1.5">
              {group.todos.map((todo) => (
                <WorkspaceTodoRow
                  key={todo.id}
                  todo={todo}
                  expanded={expandedIds.has(todo.id)}
                  onToggleExpand={() => toggleExpand(todo.id)}
                  onOpenDetail={() => setDetailTodo(todo)}
                  onRemove={() => {
                    void (async () => {
                      if (!isScheduledTodo(todo)) await removePending(todo.id)
                      else await removeTodo(todo.id)
                      onTodoSaved()
                    })()
                  }}
                />
              ))}
              {group.todos.length === 0 && (
                <li className="rounded-md border border-dashed py-5 text-center text-[10px] text-muted-foreground">暂无任务</li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  )
}

function WeeklyControlPanel({
  todos,
  allTodos,
  weekAnchor,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  actions,
}: {
  todos: TodoItem[]
  allTodos: Todo[]
  weekAnchor: Date
  isDragOver: boolean
  onDragOver: (event: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: React.DragEvent) => void
  actions: Pick<ReturnType<typeof useTodoStore.getState>, 'startTodo' | 'completeTodo' | 'removeTodo' | 'addTodoTree' | 'updateTodo' | 'addSubtask'>
}) {
  const { startTodo, completeTodo, removeTodo, addTodoTree, updateTodo, addSubtask } = actions
  const [mode, setMode] = useState<'plan' | 'review'>('plan')
  const [addOpen, setAddOpen] = useState(false)
  const [detailTodo, setDetailTodo] = useState<TodoItem | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const dayTabs = useMemo(() => getVisibleWeekDayTabs(weekAnchor), [weekAnchor])
  const parentById = useMemo(() => new Map(allTodos.map((todo) => [todo.id, todo])), [allTodos])
  const relevant = useMemo(() => todos.filter((todo) => todo.status !== 'cancelled'), [todos])
  const plannedMinutes = relevant.reduce((sum, todo) => sum + Math.round(todo.estimatedHours * 60), 0)
  const done = relevant.filter((todo) => todo.status === 'done')
  const blocked = relevant.filter((todo) => todo.status === 'blocked')
  const open = relevant.filter((todo) => todo.status !== 'done')

  const loadByDay = useMemo(() => Array.from({ length: 7 }, (_, dayIndex) => ({
    dayIndex,
    minutes: relevant.filter((todo) => todo.dayIndex === dayIndex).reduce((sum, todo) => sum + Math.round(todo.estimatedHours * 60), 0),
  })), [relevant])
  const maxLoad = Math.max(60, ...loadByDay.map((day) => day.minutes))

  const groups = useMemo(() => {
    const map = new Map<string, TodoItem[]>()
    for (const todo of relevant) {
      const key = todo.parentId ?? '__standalone__'
      map.set(key, [...(map.get(key) ?? []), todo])
    }
    return [...map.entries()].map(([parentId, rawItems]) => {
      const items = rawItems.sort((a, b) => a.dayIndex - b.dayIndex || a.sortOrder - b.sortOrder)
      const parent = parentId === '__standalone__' ? null : parentById.get(parentId)
      return {
        parentId,
        title: parentId === '__standalone__' ? '独立任务' : parent?.title ?? '其他目标',
        description: parent?.description ?? '',
        items,
        doneCount: items.filter((item) => item.status === 'done').length,
        minutes: items.reduce((sum, item) => sum + Math.round(item.estimatedHours * 60), 0),
        next: items.find((item) => item.status !== 'done'),
      }
    })
  }, [relevant, parentById])

  const toggleGroup = (id: string) => setExpandedGroups((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const handleAddTodoTree = useCallback((input: {
    parent?: { title: string; aaaTopicId?: string | null }
    subtasks?: Array<{ title: string; estimatedHours: number }>
    root?: { title: string; estimatedHours: number; aaaTopicId?: string | null }
  }) => addTodoTree({ ...input, dayIndex: new Date().getDay() }), [addTodoTree])

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card', isDragOver && 'border-dashed border-primary bg-primary/5')}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <AddTodoDialog open={addOpen} onOpenChange={setAddOpen} dayLabel="本周" onSubmitTree={handleAddTodoTree} />
      <TodoDetailDialog item={detailTodo} open={detailTodo != null} onOpenChange={(value) => { if (!value) setDetailTodo(null) }} updateTodo={updateTodo} addSubtask={addSubtask} onDelete={async (id) => { await removeTodo(id) }} initialMode="view" />

      <div className="grid shrink-0 gap-3 border-b p-3 lg:grid-cols-[1fr_auto]">
        <div className="grid grid-cols-4 gap-2">
          <div><p className="text-[10px] text-muted-foreground">本周承诺</p><p className="text-lg font-semibold">{relevant.length} 项</p></div>
          <div><p className="text-[10px] text-muted-foreground">计划投入</p><p className="text-lg font-semibold">{formatEstimatedDuration(plannedMinutes / 60)}</p></div>
          <div><p className="text-[10px] text-muted-foreground">已完成</p><p className="text-lg font-semibold text-emerald-600">{done.length}</p></div>
          <div><p className="text-[10px] text-muted-foreground">待收口</p><p className="text-lg font-semibold text-amber-600">{open.length}</p></div>
        </div>
        <div className="flex items-start gap-1 rounded-md bg-muted p-1">
          <button type="button" onClick={() => setMode('plan')} className={cn('rounded px-3 py-1.5 text-xs', mode === 'plan' && 'bg-background font-medium shadow-sm')}>本周计划</button>
          <button type="button" onClick={() => setMode('review')} className={cn('rounded px-3 py-1.5 text-xs', mode === 'review' && 'bg-background font-medium shadow-sm')}>本周复盘</button>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-7 gap-1 border-b px-3 py-2" aria-label="七日负载">
        {loadByDay.map((day) => {
          const tab = dayTabs.find((item) => item.dayIndex === day.dayIndex)
          const overloaded = day.minutes > 240
          return (
            <div key={day.dayIndex} className="min-w-0 text-center">
              <div className="flex h-8 items-end justify-center rounded bg-muted/60 px-1">
                <div className={cn('w-full rounded-sm', overloaded ? 'bg-amber-400' : 'bg-sky-400')} style={{ height: `${Math.max(day.minutes > 0 ? 12 : 2, (day.minutes / maxLoad) * 100)}%` }} />
              </div>
              <p className="mt-1 truncate text-[10px] font-medium">{WEEKDAY_LABELS[day.dayIndex]}</p>
              <p className={cn('text-[9px] text-muted-foreground', overloaded && 'font-medium text-amber-600')}>{day.minutes ? formatEstimatedDuration(day.minutes / 60) : '空闲'}</p>
              {tab?.isToday && <span className="text-[9px] text-emerald-600">今天</span>}
            </div>
          )
        })}
      </div>

      {mode === 'review' && (
        <div className="grid shrink-0 gap-2 border-b bg-muted/20 p-3 sm:grid-cols-3">
          <div className="rounded-md bg-background p-2"><p className="text-[10px] text-muted-foreground">完成情况</p><p className="mt-1 text-xs">完成 {done.length}/{relevant.length} 项，{relevant.length ? Math.round(done.length / relevant.length * 100) : 0}%</p></div>
          <div className="rounded-md bg-background p-2"><p className="text-[10px] text-muted-foreground">阻塞检查</p><p className="mt-1 text-xs">{blocked.length ? `${blocked.length} 项需要解除阻塞` : '本周没有阻塞项'}</p></div>
          <div className="rounded-md bg-background p-2"><p className="text-[10px] text-muted-foreground">下周处理</p><p className="mt-1 text-xs">{open.length ? `${open.length} 项需决定：顺延、退回或取消` : '本周任务已全部收口'}</p></div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
        <div className="mb-2 flex items-center justify-between">
          <div><h3 className="text-sm font-semibold">{mode === 'plan' ? '本周成果' : '成果复盘'}</h3><p className="text-[10px] text-muted-foreground">默认只看目标与里程碑，行动明细按需展开</p></div>
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setAddOpen(true)}><Plus className="size-3.5" />添加到本周</Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.parentId} className="overflow-hidden rounded-lg border">
              <button type="button" onClick={() => toggleGroup(group.parentId)} className="w-full p-3 text-left transition-colors hover:bg-muted/30" aria-expanded={expandedGroups.has(group.parentId)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="truncate text-sm font-semibold">{group.title}</h4>
                      {group.doneCount === group.items.length && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] text-emerald-700">已收口</span>}
                    </div>
                    {group.description && <p className="mt-1 line-clamp-1 text-[10px] text-muted-foreground">{group.description}</p>}
                  </div>
                  <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', expandedGroups.has(group.parentId) && 'rotate-180')} />
                </div>
                <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${group.items.length ? group.doneCount / group.items.length * 100 : 0}%` }} /></div>
                  <span className="text-[10px] tabular-nums text-muted-foreground">{group.doneCount}/{group.items.length} · {formatEstimatedDuration(group.minutes / 60)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-[10px]">
                  <span className="text-muted-foreground">{group.next ? (mode === 'review' ? '尚未收口' : '下一里程碑') : '本周结果'}</span>
                  <span className="min-w-0 truncate font-medium">{group.next?.title ?? '本周计划已完成'}</span>
                </div>
              </button>
              {expandedGroups.has(group.parentId) && (
                <ul className="divide-y border-t bg-muted/10">
                  {group.items.map((todo) => (
                    <li key={todo.id} className="flex items-start gap-3 px-3 py-2.5">
                      <button type="button" onClick={() => void (todo.status === 'done' ? Promise.resolve() : completeTodo(todo.id))} className="mt-0.5" aria-label="完成任务">
                        <StatusGlyph status={todo.status} />
                      </button>
                      <button type="button" onClick={() => setDetailTodo(todo)} className="min-w-0 flex-1 text-left"><span className={cn('text-xs font-medium', todo.status === 'done' && 'text-muted-foreground line-through')}>{todo.title}</span><p className="mt-1 text-[10px] text-muted-foreground">{WEEKDAY_LABELS[todo.dayIndex]} · {formatEstimatedDuration(todo.estimatedHours)} · {TODO_STATUS_LABEL[todo.status]}</p></button>
                      {todo.status === 'pending' && <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => void startTodo(todo.id)}><Play className="mr-1 size-3" />开始</Button>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {groups.length === 0 && <div className="rounded-lg border border-dashed py-14 text-center"><p className="text-sm font-medium">本周还没有承诺事项</p><p className="mt-1 text-xs text-muted-foreground">从任务地图拖入，或添加一个本周成果。</p></div>}
        </div>
      </div>
    </div>
  )
}

function WeekReviewSummary({ todos }: { todos: TodoItem[] }) {
  const relevant = todos.filter((todo) => todo.status !== 'cancelled')
  const done = relevant.filter((todo) => todo.status === 'done')
  const active = relevant.filter((todo) => todo.status === 'active')
  const blocked = relevant.filter((todo) => todo.status === 'blocked')
  const pending = relevant.filter((todo) => todo.status === 'pending')
  const plannedMinutes = relevant.reduce((sum, todo) => sum + Math.round(todo.estimatedHours * 60), 0)
  const completion = relevant.length === 0 ? 0 : Math.round((done.length / relevant.length) * 100)
  return (
    <section className="mb-3 grid shrink-0 gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[auto_1fr]" aria-label="本周复盘摘要">
      <div className="grid grid-cols-3 gap-2 sm:min-w-64">
        <div><p className="text-[10px] text-muted-foreground">完成率</p><p className="text-lg font-semibold tabular-nums">{completion}%</p></div>
        <div><p className="text-[10px] text-muted-foreground">计划投入</p><p className="text-lg font-semibold tabular-nums">{formatEstimatedDuration(plannedMinutes / 60)}</p></div>
        <div><p className="text-[10px] text-muted-foreground">阻塞</p><p className="text-lg font-semibold tabular-nums">{blocked.length}</p></div>
      </div>
      <div className="rounded-md bg-background/70 px-3 py-2 text-xs">
        <p className="font-medium">本周复盘</p>
        <p className="mt-1 text-muted-foreground">已完成 {done.length} 项，进行中 {active.length} 项，待开始 {pending.length} 项。{pending.length > 0 ? `未完成重点：${pending.slice(0, 2).map((todo) => todo.title).join('、')}。` : '当前计划已全部收口。'}</p>
      </div>
    </section>
  )
}

export default function WeekPlanPage() {
  const [weekAnchor, setWeekAnchor] = useState(() => new Date())
  const [activeDayIndex, setActiveDayIndex] = useState(() => new Date().getDay())
  const [isTodoDragOver, setIsTodoDragOver] = useState(false)
  const [isPendingDragOver, setIsPendingDragOver] = useState(false)
  const [allTodos, setAllTodos] = useState<Todo[]>([])
  const [todosReady, setTodosReady] = useState(false)
  const [executionActivity, setExecutionActivity] = useState<ExecutionActivity[]>([])
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [view, setView] = useState<WorkspaceViewId>('week')
  const phone = usePhoneLayout()
  const router = useRouter()
  const searchParams = useSearchParams()
  const insightsFromUrl = searchParams.get('panel') === 'insights'
  const linkedTodoId = searchParams.get('todo')

  const weekStart = formatWeekStartClient(weekAnchor)
  const isLoading = useTodoStore((s) => s.isLoading)
  const loadError = useTodoStore((s) => s.error)
  const loadWeek = useTodoStore((s) => s.loadWeek)

  useEffect(() => {
    const visible = getVisibleWeekDayTabs(weekAnchor)
    if (!visible.some((t) => t.dayIndex === activeDayIndex)) {
      const fallback = visible[visible.length - 1]?.dayIndex ?? weekAnchor.getDay()
      setActiveDayIndex(fallback)
    }
  }, [weekAnchor, activeDayIndex])

  useEffect(() => {
    void loadWeek(weekStart)
  }, [weekStart, loadWeek])

  const pending = useTodoStore((s) => s.pending)
  const todos = useTodoStore((s) => s.todos)
  const todoVersionKey = todos.map((todo) => `${todo.id}:${todo.version}`).join('|')
  const pendingVersionKey = pending.map((todo) => `${todo.id}:${todo.title}:${todo.day}`).join('|')
  const draggingPayload = useTodoStore((s) => s.draggingPayload)
  const setDraggingPayload = useTodoStore((s) => s.setDraggingPayload)
  const addTodoFromDrop = useTodoStore((s) => s.addTodoFromDrop)
  const moveTodoBackToPending = useTodoStore((s) => s.moveTodoBackToPending)
  const startTodo = useTodoStore((s) => s.startTodo)
  const completeTodo = useTodoStore((s) => s.completeTodo)
  const removeTodo = useTodoStore((s) => s.removeTodo)
  const addTodoTree = useTodoStore((s) => s.addTodoTree)
  const updateTodo = useTodoStore((s) => s.updateTodo)
  const addSubtask = useTodoStore((s) => s.addSubtask)
  const addPending = useTodoStore((s) => s.addPending)
  const removePending = useTodoStore((s) => s.removePending)

  const refreshAllTodos = useCallback(() => {
    fetch('/api/todos', { credentials: 'include' })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok || !result.success) throw new Error(result.error || 'Todo 加载失败')
        setAllTodos(Array.isArray(result.data) ? result.data.map((todo: Todo) => ({
          ...todo,
          timeLinks: Array.isArray(todo.timeLinks) ? todo.timeLinks : [],
          tags: Array.isArray(todo.tags) ? todo.tags : [],
        })) : [])
      })
      .catch(() => undefined)
      .finally(() => setTodosReady(true))
  }, [])

  const closeLinkedTodo = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('todo')
    router.replace(params.size ? `/?${params.toString()}` : '/', { scroll: false })
  }, [router, searchParams])

  const saveLinkedTodo = useCallback(async (id: string, input: Parameters<ReturnType<typeof useTodoStore.getState>['updateTodo']>[1]) => {
    await apiUpdateTodo(id, input)
    refreshAllTodos()
    await loadWeek(weekStart)
  }, [refreshAllTodos, loadWeek, weekStart])

  const refreshExecutionActivity = useCallback(() => {
    const from = new Date()
    from.setDate(from.getDate() - 16 * 7)
    fetch(`/api/execution/activity?from=${encodeURIComponent(from.toISOString())}`, { credentials: 'include' })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok || !result.success) throw new Error(result.error || '执行记录加载失败')
        setExecutionActivity(result.data)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshAllTodos()
  }, [todoVersionKey, pendingVersionKey, refreshAllTodos])

  useEffect(() => { refreshExecutionActivity() }, [refreshExecutionActivity])

  const toggleInsights = useCallback(() => {
    if (phone) {
      if (insightsFromUrl) closePhonePanel(router)
      else openPhonePanel(router, '/?panel=insights')
      return
    }
    setInsightsOpen((open) => !open)
  }, [phone, insightsFromUrl, router])
  const toggleInsightsRef = useRef(toggleInsights)
  toggleInsightsRef.current = toggleInsights

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
      if (document.querySelector('[role="dialog"]:not(#todo-insights-drawer)')) return
      event.preventDefault()
      event.stopPropagation()
      toggleInsightsRef.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const showInsights = phone ? insightsFromUrl : insightsOpen

  const yearWeekLabel = useMemo(() => getYearWeekLabel(weekAnchor), [weekAnchor])

  const goPrevWeek = () => {
    const nextStart = shiftWeekStart(weekStart, -1)
    const [y, m, d] = nextStart.split('-').map(Number)
    setWeekAnchor(new Date(y, m - 1, d))
  }

  const goNextWeek = () => {
    const nextStart = shiftWeekStart(weekStart, 1)
    const [y, m, d] = nextStart.split('-').map(Number)
    setWeekAnchor(new Date(y, m - 1, d))
  }

  const goCurrentWeek = () => {
    setWeekAnchor(new Date())
    setActiveDayIndex(new Date().getDay())
  }

  const selectWeek = useCallback((selectedWeekStart: string) => {
    const [year, month, day] = selectedWeekStart.split('-').map(Number)
    setWeekAnchor(new Date(year, month - 1, day))
    const currentWeekStart = formatWeekStartClient(new Date())
    setActiveDayIndex(selectedWeekStart === currentWeekStart ? new Date().getDay() : 0)
  }, [])

  const isCurrentWeek =
    formatWeekStartClient(new Date()) === weekStart

  const handleTodoDragOver = useCallback(
    (e: React.DragEvent) => {
      const payload = draggingPayload
      if (!hasActivityDragPayload(e.dataTransfer) && !payload) return
      if (payload?.source === 'todo') return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setIsTodoDragOver(true)
    },
    [draggingPayload]
  )

  const handleTodoDragLeave = useCallback(() => {
    setIsTodoDragOver(false)
  }, [])

  const handleTodoDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsTodoDragOver(false)
      const payload = parseActivityDragPayload(e.dataTransfer) ?? draggingPayload
      if (!payload || payload.source !== 'pending') return
      addTodoFromDrop(payload, activeDayIndex)
      setDraggingPayload(null)
    },
    [activeDayIndex, addTodoFromDrop, draggingPayload, setDraggingPayload]
  )

  const handlePendingDragOver = useCallback(
    (e: React.DragEvent) => {
      const payload = draggingPayload
      if (!hasActivityDragPayload(e.dataTransfer) && !payload) return
      if (payload?.source === 'pending') return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setIsPendingDragOver(true)
    },
    [draggingPayload]
  )

  const handlePendingDragLeave = useCallback(() => {
    setIsPendingDragOver(false)
  }, [])

  const handlePendingDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsPendingDragOver(false)
      const payload = parseActivityDragPayload(e.dataTransfer) ?? draggingPayload
      if (!payload || payload.source !== 'todo') return
      moveTodoBackToPending(payload.id)
      setDraggingPayload(null)
    },
    [draggingPayload, moveTodoBackToPending, setDraggingPayload]
  )

  return (
    <TagWorkspaceProvider>
    <div className="flex h-svh flex-col md:flex-row">
      <TodoDetailDialog
        item={linkedTodoId ? allTodos.find((todo) => todo.id === linkedTodoId) ?? null : null}
        open={Boolean(linkedTodoId && allTodos.some((todo) => todo.id === linkedTodoId))}
        onOpenChange={(open) => { if (!open) closeLinkedTodo() }}
        updateTodo={saveLinkedTodo}
        initialMode="view"
      />
      {!phone && (
        <AppToolbar
          className="hidden md:flex"
          view={view}
          onViewChange={setView}
          insightsOpen={insightsOpen}
          onToggleInsights={toggleInsights}
        />
      )}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden max-md:pt-[env(safe-area-inset-top)]">
        <div className="relative mx-auto flex h-full max-w-[90rem] flex-col overflow-hidden p-0 md:p-6">
          {loadError && (
            <div className="mb-4 shrink-0 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {loadError}
              <button
                type="button"
                className="ml-3 underline"
                onClick={() => void loadWeek(weekStart)}
              >
                重试
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden md:overflow-y-auto xl:overflow-hidden">
            <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden md:h-auto md:overflow-visible xl:h-full xl:overflow-hidden" aria-label="今日执行与任务地图">
              <TodayExecutionCenter
                view={view}
                onViewChange={(next) => {
                  setView(next)
                  if (phone && insightsFromUrl) closePhonePanel(router)
                }}
                todos={allTodos}
                todosReady={todosReady}
                onTodosChanged={refreshAllTodos}
                onExecutionChanged={refreshExecutionActivity}
              />
            </section>
          </div>
          <Dialog open={overviewOpen} onOpenChange={setOverviewOpen}>
            <DialogContent className="h-[92vh] w-[96vw] max-w-none overflow-hidden p-2 sm:p-4" overlayClassName="bg-neutral-950/30 backdrop-blur-sm">
              <DialogHeader className="sr-only">
                <DialogTitle>任务地图</DialogTitle>
                <DialogDescription>按注意力阶段查看和安排全部 Todo。</DialogDescription>
              </DialogHeader>
              <TodoWorkspacePanel
                overview
                todos={allTodos}
                dragProps={{
                  isDragOver: isPendingDragOver,
                  onDragOver: handlePendingDragOver,
                  onDragLeave: handlePendingDragLeave,
                  onDrop: handlePendingDrop,
                }}
                actions={{ addPending, removePending, removeTodo }}
                updateTodo={updateTodo}
                onTodoSaved={refreshAllTodos}
              />
            </DialogContent>
          </Dialog>
        </div>
        {!phone && <div className={cn('absolute inset-0 z-40 overflow-hidden', !insightsOpen && 'pointer-events-none')} aria-hidden={!insightsOpen}>
          <button type="button" tabIndex={insightsOpen ? 0 : -1} aria-label="收起周视图抽屉" onClick={() => setInsightsOpen(false)} className={cn('absolute inset-0 bg-black/20 backdrop-blur-[1px] transition-opacity duration-300 ease-out motion-reduce:transition-none', insightsOpen ? 'opacity-100' : 'opacity-0')} />
          <aside id="todo-insights-drawer" role="dialog" aria-modal="true" aria-label="Todo 时间与周视图" inert={!insightsOpen} className={cn('absolute inset-y-0 left-0 z-10 flex w-[min(22rem,92vw)] flex-col border-r bg-background p-3 shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none', insightsOpen ? 'translate-x-0' : '-translate-x-full')}>
            <div className="mb-3 flex shrink-0 items-center justify-between border-b pb-3">
              <div><h2 className="text-sm font-semibold">周视图与投入</h2><p className="mt-0.5 text-[10px] text-muted-foreground">按 ⌥Esc 收起或再次弹出</p></div>
              <button type="button" onClick={() => setInsightsOpen(false)} aria-label="关闭抽屉" className="rounded-md border p-1.5 hover:bg-muted"><X className="size-4" /></button>
            </div>
            <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto">
              <TodoTimelineCalendar todos={allTodos} compact selectedWeekStart={weekStart} onWeekSelect={selectWeek} />
              <TodoActivityView todos={allTodos} executionSessions={executionActivity} compact selectedWeekStart={weekStart} onWeekSelect={selectWeek} />
            </div>
          </aside>
        </div>}
        {phone && insightsFromUrl && (
          <MobileSheet title="周视图与投入" onClose={() => closePhonePanel(router)}>
            <div className="grid content-start gap-3">
              <TodoTimelineCalendar todos={allTodos} compact selectedWeekStart={weekStart} onWeekSelect={selectWeek} />
              <TodoActivityView todos={allTodos} executionSessions={executionActivity} compact selectedWeekStart={weekStart} onWeekSelect={selectWeek} />
            </div>
          </MobileSheet>
        )}
      </div>
      <MobileTabBar
        view={view}
        insightsOpen={showInsights}
        onViewChange={(next) => {
          setView(next)
          if (phone && insightsFromUrl) closePhonePanel(router)
        }}
        onToggleInsights={toggleInsights}
      />
    </div>
    </TagWorkspaceProvider>
  )
}
