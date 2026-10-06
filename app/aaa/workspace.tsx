'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight, Plus, Save, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { AaaRecord, AaaTopic, AaaWorkflowAction } from '@/types/aaa'
import { WorkingTodos } from './working-todos'

type Selection = { type: 'pool' } | { type: 'topic'; id: string } | { type: 'week'; id: string; week: number } | { type: 'archive' }
type Mutation = <T>(operation: () => Promise<T>) => Promise<T>
const STATUS_NAME = { pool: 'Pool', registry: 'Registry', review: '评审周', working: 'Working', archive: '馆藏' }
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
function currentWorkingWeek(topic: AaaTopic, now: number): number {
  const started = topic.workingStartedAt ? Date.parse(topic.workingStartedAt) : NaN
  return Number.isFinite(started) ? Math.max(1, Math.floor((now - started) / WEEK_MS) + 1) : 1
}
function currentCycleNotes(topic: AaaTopic) {
  return topic.entries.filter((entry) => entry.kind === 'weekly_note' && topic.workingStartedAt && entry.createdAt >= topic.workingStartedAt)
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error(body.error || '请求失败')
  return body.data
}
function writeRequest<T>(url: string, data: unknown, method = 'POST') {
  return request<T>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
}
function transition(id: string, action: AaaWorkflowAction, data: Record<string, unknown> = {}) {
  return writeRequest<AaaTopic>(`/api/aaa/topics/${id}/transition`, { action, ...data })
}
function sectionName(selection: Selection | null) {
  return selection?.type === 'pool' ? 'pool' : selection?.type === 'archive' ? 'archive' : selection?.type === 'week' ? `${selection.id}:${selection.week}` : selection?.type === 'topic' ? selection.id : ''
}

export default function AaaWorkspace() {
  const [topics, setTopics] = useState<AaaTopic[]>([])
  const [selection, setSelection] = useState<Selection>({ type: 'pool' })
  const [dirtyTopicId, setDirtyTopicId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      setTopics(await request<AaaTopic[]>('/api/aaa/topics'))
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '加载失败') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer) }, [])
  const mutate: Mutation = async (operation) => {
    try { setError(''); const result = await operation(); await load(); return result }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); throw cause }
  }
  const selected = selection.type === 'topic' || selection.type === 'week' ? topics.find((topic) => topic.id === selection.id) : null
  const active = topics.find((topic) => topic.status === 'working')
  const select = (next: Selection) => {
    if (sectionName(next) === sectionName(selection)) return
    if (dirtyTopicId && !window.confirm('当前 Topic 有未保存的修改。确定离开并放弃这些修改吗？')) return
    setDirtyTopicId(null)
    setSelection(next)
  }

  return <div className="flex h-svh flex-col bg-background">
    <header className="flex shrink-0 items-center gap-3 border-b px-3 py-2 sm:px-5">
      <Link href="/" onClick={(event) => { if (dirtyTopicId && !window.confirm('当前 Topic 有未保存的修改。确定离开吗？')) event.preventDefault() }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"><ArrowLeft className="size-4"/>返回</Link>
      <Sparkles className="size-4"/>
      <div><h1 className="text-sm font-semibold">AAA · 应用奥秘学会</h1><p className="text-[10px] text-muted-foreground">Interest may branch. Attention should not.</p></div>
    </header>
    {error && <div className="border-b bg-red-50 px-4 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
    <div className="grid min-h-0 flex-1 md:grid-cols-[300px_minmax(0,1fr)]">
      <Sidebar topics={topics} selection={selection} onSelect={select} now={now}/>
      <main className="min-h-0 overflow-y-auto">
        {loading ? <p className="p-8 text-sm text-muted-foreground">载入中…</p>
          : selection.type === 'pool' ? <PoolPage topics={topics.filter((topic) => topic.status === 'pool')} onMutate={mutate} onOpened={(id) => setSelection({ type: 'topic', id })}/>
          : selection.type === 'archive' ? <ArchivePage topics={topics.filter((topic) => topic.status === 'archive')} onSelect={(id) => select({ type: 'topic', id })}/>
          : selection.type === 'week' && selected ? <WorkingWeek topic={selected} week={selection.week} currentWeek={currentWorkingWeek(selected, now)} onMutate={mutate}/>
          : selected ? <TopicPage key={`${selected.id}:${selected.status}`} topic={selected} activeExists={Boolean(active && active.id !== selected.id)} onMutate={mutate} onDirtyChange={setDirtyTopicId} currentWeek={currentWorkingWeek(selected, now)} onOpenWeek={(week) => select({ type: 'week', id: selected.id, week })}/>
          : <p className="p-8 text-sm text-muted-foreground">请选择一个 Topic。</p>}
      </main>
    </div>
  </div>
}

function Sidebar({ topics, selection, onSelect, now }: { topics: AaaTopic[]; selection: Selection; onSelect: (value: Selection) => void; now: number }) {
  const current = sectionName(selection)
  const pool = topics.filter((topic) => topic.status === 'pool')
  const registry = topics.filter((topic) => topic.status === 'registry')
  const review = topics.filter((topic) => topic.status === 'review')
  const working = topics.find((topic) => topic.status === 'working')
  const currentWeek = working ? currentWorkingWeek(working, now) : null
  const workingWeeks = working ? Array.from(new Set([...Array.from({ length: working.plannedWeeks ?? 0 }, (_, index) => index + 1), ...currentCycleNotes(working).filter((entry) => entry.week).map((entry) => entry.week!), currentWeek!])).sort((a, b) => a - b) : []
  const archived = topics.filter((topic) => topic.status === 'archive')
  const row = (topic: AaaTopic) => <button key={topic.id} onClick={() => onSelect({ type: 'topic', id: topic.id })} className={cn('w-full rounded-md px-3 py-2 text-left text-sm', current === topic.id ? 'bg-foreground text-background' : 'hover:bg-muted')}>{topic.title}</button>
  return <aside className="overflow-y-auto border-b bg-muted/20 px-3 py-4 md:border-b-0 md:border-r">
    <NavHeading title="Topic"/>
    <button onClick={() => onSelect({ type: 'pool' })} className={cn('mb-4 w-full rounded-md p-2 text-left', current === 'pool' ? 'bg-foreground text-background' : 'hover:bg-muted')}>
      <span className="flex justify-between text-sm font-semibold"><span>Pool</span><span>{pool.length}</span></span>
      <span className="mt-1 block text-[11px] opacity-70">仅记录，不进入生命周期</span>
    </button>
    <NavGroup title="Registry" count={registry.length} hint="正式注册 · 预研与周期设计">{registry.map(row)}</NavGroup>
    <NavHeading title="Working"/>
    <NavGroup title="评审周" count={review.length} hint="更新周数与每周目标">{review.map(row)}</NavGroup>
    <NavGroup title="Active Working" count={working ? 1 : 0} hint="按评审计划展开">
      {working && <>
        <button onClick={() => onSelect({ type: 'topic', id: working.id })} className={cn('flex w-full items-center gap-1 rounded-md px-3 py-2 text-left text-sm font-medium', current === working.id ? 'bg-foreground text-background' : 'hover:bg-muted')}><ChevronRight className="size-3.5"/>{working.title}<span className="ml-auto text-[10px] opacity-70">当前 Week {currentWeek}</span></button>
        <div className="ml-4 border-l pl-2">{workingWeeks.map((week) => <button key={week} onClick={() => onSelect({ type: 'week', id: working.id, week })} className={cn('my-0.5 block w-full rounded-md px-2 py-1.5 text-left text-xs', current === `${working.id}:${week}` ? 'bg-foreground text-background' : week === currentWeek ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted')}><span className="font-medium">Week {week}{week === currentWeek ? ' · 当前' : ''}</span><span className="ml-2 line-clamp-1">{working.plan.weeklyGoals?.[week - 1] || (week > (working.plannedWeeks ?? 0) ? '计划外延续' : '待定义目标')}</span></button>)}</div>
      </>}
    </NavGroup>
    <NavHeading title="圣堂"/>
    <button onClick={() => onSelect({ type: 'archive' })} className={cn('mb-1 flex w-full justify-between rounded-md px-3 py-2 text-left text-sm', current === 'archive' ? 'bg-foreground text-background' : 'hover:bg-muted')}><span>馆藏</span><span>{archived.length}</span></button>
    {archived.map(row)}
  </aside>
}
function NavHeading({ title }: { title: string }) { return <h2 className="mb-2 mt-5 first:mt-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</h2> }
function NavGroup({ title, count, hint, children }: { title: string; count: number; hint: string; children: React.ReactNode }) { return <section className="mb-4"><div className="flex justify-between text-sm font-semibold"><span>{title}</span><span className="text-muted-foreground">{count}</span></div><p className="mb-1.5 mt-0.5 text-[11px] text-muted-foreground">{hint}</p><div className="space-y-1">{children}</div></section> }

function PoolPage({ topics, onMutate, onOpened }: { topics: AaaTopic[]; onMutate: Mutation; onOpened: (id: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [opening, setOpening] = useState<AaaTopic | null>(null)
  const [editing, setEditing] = useState<AaaTopic | null>(null)
  return <div className="mx-auto max-w-6xl p-4 sm:p-7">
    <div className="flex items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">Pool</h1><p className="mt-1 text-sm text-muted-foreground">收集想法，不产生执行义务。</p></div><Button size="sm" onClick={() => setAdding(true)}><Plus className="mr-1 size-3.5"/>记录</Button></div>
    <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {topics.map((topic) => <article key={topic.id} className="flex min-h-44 flex-col rounded-xl border bg-card p-4"><h2 className="font-semibold">{topic.title}</h2><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{topic.description || '暂无描述'}</p><p className="mt-2 text-xs text-muted-foreground">记录 {topic.records.length} 条</p><div className="mt-auto flex gap-2 pt-4"><Button size="sm" onClick={() => setOpening(topic)}>开题</Button><Button size="sm" variant="outline" onClick={() => setEditing(topic)}>编辑</Button></div></article>)}
      {!topics.length && <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">Pool 还没有 Topic。</div>}
    </div>
    {(adding || editing) && <PoolForm key={editing?.id ?? 'new'} topic={editing} onClose={() => { setAdding(false); setEditing(null) }} onSave={async (data) => { await onMutate(() => editing ? writeRequest(`/api/aaa/topics/${editing.id}`, data, 'PATCH') : writeRequest('/api/aaa/topics', data)); setAdding(false); setEditing(null) }} onDelete={editing ? async () => { await onMutate(() => request(`/api/aaa/topics/${editing.id}`, { method: 'DELETE' })); setEditing(null) } : undefined}/>}
    {opening && <OpeningForm topic={opening} onClose={() => setOpening(null)} onSubmit={async (data) => { await onMutate(() => transition(opening.id, 'open', data)); onOpened(opening.id); setOpening(null) }}/>}
  </div>
}

function RecordFields({ records, onChange }: { records: AaaRecord[]; onChange: (records: AaaRecord[]) => void }) {
  const change = (index: number, patch: Partial<AaaRecord>) => onChange(records.map((record, i) => i === index ? { ...record, ...patch } : record))
  return <section><div className="flex items-center justify-between"><div><h3 className="text-xs font-semibold">记录</h3><p className="mt-1 text-[11px] text-muted-foreground">收集内容与参考链接，至少填写一项。</p></div><Button type="button" size="sm" variant="outline" onClick={() => onChange([...records, { content: '', link: '' }])}><Plus className="mr-1 size-3"/>添加记录</Button></div><div className="mt-3 space-y-3">{records.map((record, index) => <div key={index} className="rounded-lg border bg-card p-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1 space-y-2"><Textarea aria-label={`记录 ${index + 1} 内容`} rows={2} value={record.content} placeholder="记录内容" onChange={(event) => change(index, { content: event.target.value })}/><div className="flex items-center gap-2"><Input aria-label={`记录 ${index + 1} 链接`} value={record.link} placeholder="https://...（可选）" onChange={(event) => change(index, { link: event.target.value })}/>{/^https?:\/\//i.test(record.link) && <a href={record.link} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs underline">打开</a>}</div></div><Button type="button" variant="ghost" size="icon" aria-label={`删除记录 ${index + 1}`} onClick={() => onChange(records.filter((_, i) => i !== index))}><X className="size-4"/></Button></div></div>)}</div></section>
}

function PoolForm({ topic, onClose, onSave, onDelete }: { topic: AaaTopic | null; onClose: () => void; onSave: (data: { title: string; description: string; records: AaaRecord[] }) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [title, setTitle] = useState(topic?.title ?? '')
  const [description, setDescription] = useState(topic?.description ?? '')
  const [records, setRecords] = useState(topic?.records ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => { setBusy(true); try { await onSave({ title, description, records }); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败') } finally { setBusy(false) } }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><form onSubmit={(event) => { event.preventDefault(); void submit() }} className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border bg-background p-5 shadow-xl"><div><h2 className="font-semibold">{topic ? '编辑 Pool 记录' : '记录到 Pool'}</h2><p className="mt-1 text-xs text-muted-foreground">保存标题、描述与记录。</p></div><LabelText label="标题" value={title} onChange={setTitle}/><LabelArea label="描述" value={description} onChange={setDescription}/><RecordFields records={records} onChange={setRecords}/>{error && <p className="text-xs text-destructive">{error}</p>}<div className="flex justify-end gap-2">{onDelete && <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={() => { if (confirm('删除这条 Pool 记录？')) void onDelete().catch((cause) => setError(cause instanceof Error ? cause.message : '删除失败')) }}>删除</Button>}<Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="submit" disabled={!title.trim() || busy}>保存</Button></div></form></div>
}

function OpeningForm({ topic, onClose, onSubmit }: { topic: AaaTopic; onClose: () => void; onSubmit: (data: { title: string; description: string; records: AaaRecord[]; question: string; scope: string }) => Promise<void> }) {
  const [title, setTitle] = useState(topic.title)
  const [description, setDescription] = useState(topic.description)
  const [records, setRecords] = useState(topic.records)
  const [question, setQuestion] = useState(topic.question)
  const [scope, setScope] = useState(topic.scope)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><form onSubmit={(event) => { event.preventDefault(); setBusy(true); void onSubmit({ title, description, records, question, scope }).catch((cause) => setError(cause instanceof Error ? cause.message : '开题失败')).finally(() => setBusy(false)) }} className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border bg-background p-5 shadow-xl"><div><h2 className="font-semibold">开题</h2><p className="mt-1 text-xs text-muted-foreground">已带入 Pool 的内容，提交后正式进入 Registry。</p></div><LabelText label="标题" value={title} onChange={setTitle}/><LabelArea label="描述" value={description} onChange={setDescription}/><RecordFields records={records} onChange={setRecords}/><LabelArea label="核心问题" value={question} onChange={setQuestion}/><LabelArea label="Scope / 边界" value={scope} onChange={setScope}/>{error && <p className="text-xs text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !title.trim() || !question.trim() || !scope.trim()}>提交开题</Button></div></form></div>
}

function editableFields(topic: AaaTopic) {
  return { title: topic.title, description: topic.description, records: topic.records, question: topic.question, scope: topic.scope, notes: topic.notes, plan: topic.plan, completionRating: topic.completionRating, distinctions: topic.distinctions }
}

function TopicPage({ topic, activeExists, onMutate, onDirtyChange, currentWeek, onOpenWeek }: { topic: AaaTopic; activeExists: boolean; onMutate: Mutation; onDirtyChange: (id: string | null) => void; currentWeek: number; onOpenWeek: (week: number) => void }) {
  const [draft, setDraft] = useState(topic)
  const [baseline, setBaseline] = useState(topic)
  const [tab, setTab] = useState<'basic' | 'weeks' | 'plan' | 'results'>('basic')
  const [exitAction, setExitAction] = useState<'accept' | 'freeze' | 'cancel' | null>(null)
  const [earlyApproveOpen, setEarlyApproveOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState('')
  const editablePlan = topic.status === 'registry' || topic.status === 'review'
  const dirty = JSON.stringify(editableFields(draft)) !== JSON.stringify(editableFields(baseline))
  useEffect(() => {
    onDirtyChange(dirty ? topic.id : null)
    return () => onDirtyChange(null)
  }, [dirty, topic.id, onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => {
    if (topic.status !== 'review') return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [topic.status])
  const reviewRemaining = topic.reviewStartedAt ? Math.max(0, Date.parse(topic.reviewStartedAt) + 7 * 24 * 60 * 60 * 1000 - now) : 0
  const remainingMinutes = Math.ceil(reviewRemaining / 60_000)
  const countdown = reviewRemaining > 0 ? `${Math.floor(remainingMinutes / 1_440)} 天 ${Math.floor(remainingMinutes % 1_440 / 60)} 小时 ${remainingMinutes % 60} 分钟` : ''
  const persistDraft = async () => {
      const data = topic.status === 'working' || topic.status === 'archive'
        ? { title: draft.title, description: draft.description, records: draft.records, question: draft.question, scope: draft.scope, notes: draft.notes, completionRating: draft.completionRating, distinctions: draft.distinctions }
        : draft
      const saved = await onMutate(() => writeRequest<AaaTopic>(`/api/aaa/topics/${topic.id}`, data, 'PATCH'))
      setDraft(saved)
      setBaseline(saved)
  }
  const save = async () => {
    try { setError(''); await persistDraft() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败') }
  }
  const proceed = async (action: AaaWorkflowAction, options: Record<string, unknown> = {}) => {
    try {
      setError('')
      if (dirty) await persistDraft()
      await onMutate(() => transition(topic.id, action, options))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '阶段操作失败') }
  }
  const tabs: Array<{ key: 'basic' | 'weeks' | 'plan' | 'results'; label: string }> = [
    { key: 'basic', label: '基础信息' },
    ...(editablePlan || topic.status === 'working' ? [{ key: 'weeks' as const, label: `每周目标 · ${draft.plan.weeklyGoals?.length ?? 0} 周` }] : []),
    ...(topic.status === 'registry' ? [{ key: 'plan' as const, label: '预研' }] : []),
    ...(topic.status === 'archive' ? [{ key: 'results' as const, label: '结项' }] : []),
  ]
  return <div className="mx-auto flex min-h-full max-w-5xl flex-col p-4 sm:p-7">
    <header className="border-b pb-5"><Input aria-label="Topic 标题" className="h-auto border-0 px-0 text-xl font-semibold shadow-none focus-visible:ring-0" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/><div className="mt-2 flex flex-wrap items-center gap-3"><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{STATUS_NAME[topic.status]}</span><Lifecycle status={topic.status}/></div>{topic.status === 'review' && <p className="mt-3 text-xs text-muted-foreground">{reviewRemaining > 0 ? `建议评审期剩余 ${countdown}；可经二次确认提前开始 Working。` : '已完成建议的 7 天评审期，可以开始 Working。'}</p>}</header>
    <nav aria-label="Topic 页面" className="mt-5 flex gap-1 overflow-x-auto border-b">{tabs.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={cn('shrink-0 border-b-2 px-3 py-2 text-sm', tab === item.key ? 'border-foreground font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground')}>{item.label}</button>)}</nav>
    <div className="flex-1 py-5">
      {tab === 'basic' && <>{topic.status === 'working' && <button type="button" onClick={() => onOpenWeek(currentWeek)} className="mb-5 w-full rounded-xl border bg-muted/40 p-4 text-left hover:bg-muted"><p className="text-xs font-medium text-muted-foreground">当前 Working 周次</p><div className="mt-1 flex items-center justify-between gap-3"><div><p className="text-lg font-semibold">Week {currentWeek}{currentWeek > (topic.plannedWeeks ?? 0) ? ' · 计划外延续' : ` / ${topic.plannedWeeks} 周`}</p><p className="mt-1 text-sm text-muted-foreground">{topic.plan.weeklyGoals?.[currentWeek - 1] || '这一周没有预设目标，可在周页面记录备注。'}</p></div><ChevronRight className="size-4 shrink-0"/></div><p className="mt-2 text-xs text-muted-foreground">点击查看本周目标与备注</p></button>}<section className="grid gap-4 md:grid-cols-2"><LabelArea label="描述" value={draft.description} onChange={(description) => setDraft({ ...draft, description })}/><LabelArea label="核心问题" value={draft.question} onChange={(question) => setDraft({ ...draft, question })}/><LabelArea label="Scope / 边界" value={draft.scope} onChange={(scope) => setDraft({ ...draft, scope })}/><RecordFields records={draft.records} onChange={(records) => setDraft({ ...draft, records })}/>{topic.status === 'review' && <><LabelArea label="预期成果" value={draft.plan.expectedOutcome ?? ''} onChange={(value) => setDraft({ ...draft, plan: { ...draft.plan, expectedOutcome: value } })}/><LabelArea label="验收标准" value={draft.plan.closingCriteria ?? ''} onChange={(value) => setDraft({ ...draft, plan: { ...draft.plan, closingCriteria: value } })}/></>}{topic.status === 'working' && <><ReadField label="预期成果" value={topic.plan.expectedOutcome}/><ReadField label="验收标准" value={topic.plan.closingCriteria}/></>}</section>{topic.entries.some((entry) => entry.kind === 'review') && <section className="mt-6 rounded-lg border p-4"><h2 className="text-xs font-semibold">阶段结论</h2><div className="mt-2 space-y-2">{topic.entries.filter((entry) => entry.kind === 'review').map((entry) => <p key={entry.id} className="whitespace-pre-wrap text-sm text-muted-foreground">{entry.content}</p>)}</div></section>}<WorkingNoteHistory topic={topic}/></>}
      {tab === 'weeks' && (editablePlan ? <WeeklyGoals draft={draft} setDraft={setDraft}/> : <section className="space-y-3">{(topic.plan.weeklyGoals ?? []).map((goal, index) => <ReadField key={index} label={`Week ${index + 1}`} value={goal}/>)}</section>)}
      {tab === 'plan' && topic.status === 'registry' && <section><h2 className="text-sm font-semibold">预研</h2><p className="mt-1 text-xs text-muted-foreground">在正式评审前，整理可行性与边界。</p><div className="mt-4"><LabelArea label="预研内容" value={draft.plan.preliminaryResearch ?? ''} onChange={(value) => setDraft({ ...draft, plan: { ...draft.plan, preliminaryResearch: value } })}/></div></section>}
      {tab === 'results' && topic.status === 'archive' && <ArchiveFields draft={draft} setDraft={setDraft}/>}
      {topic.status === 'working' && tab === 'basic' && <WorkingTodos topicId={topic.id}/>}
    </div>
    {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
    <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-7 sm:px-7">
      <span className="mr-auto text-xs text-muted-foreground">{topic.status === 'review' ? reviewRemaining > 0 ? `建议评审期剩余 ${countdown}` : '建议评审期已完成' : '所有修改已保存'}{dirty && ' · 有未保存的修改'}</span>
      <Button size="sm" variant="outline" onClick={() => void save()}><Save className="mr-1 size-3.5"/>保存</Button>
      {topic.status === 'registry' && <Button size="sm" onClick={() => void proceed('beginReview')}>进入评审周</Button>}
      {topic.status === 'review' && <Button size="sm" disabled={activeExists} onClick={() => reviewRemaining > 0 ? setEarlyApproveOpen(true) : void proceed('approve')}>评审通过 · 开始 Working</Button>}
      {topic.status === 'working' && <><Button size="sm" onClick={() => setExitAction('accept')}>验收</Button><Button size="sm" variant="outline" onClick={() => setExitAction('freeze')}>冻结</Button><Button size="sm" variant="outline" onClick={() => setExitAction('cancel')}>撤销</Button></>}
    </div>
    {earlyApproveOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div role="dialog" aria-modal="true" aria-label="提前开始 Working" className="w-full max-w-md space-y-4 rounded-xl border bg-background p-5 shadow-xl"><h2 className="font-semibold">提前开始 Working？</h2><p className="text-sm text-muted-foreground">建议的评审期还剩 {countdown}。确认每周目标已准备好后，可以提前进入 Working。</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEarlyApproveOpen(false)}>继续评审</Button><Button onClick={() => { setEarlyApproveOpen(false); void proceed('approve', { confirmEarly: true }) }}>确认提前开始</Button></div></div></div>}
    {exitAction && <ExitForm topic={topic} action={exitAction} onClose={() => setExitAction(null)} onSubmit={async (reason) => { if (dirty) await persistDraft(); await onMutate(() => transition(topic.id, exitAction, { reason })); setExitAction(null) }}/>}
  </div>
}

function Lifecycle({ status }: { status: AaaTopic['status'] }) {
  const stages = [{ key: 'review', label: '评审周' }, { key: 'working', label: 'Working' }, { key: 'archive', label: '馆藏' }]
  return <div className="flex flex-wrap items-center gap-1.5 text-xs"><span className="mr-1 text-muted-foreground">Lifecycle</span>{stages.map((stage, index) => <span key={stage.key} className="inline-flex items-center gap-1.5"><span className={cn('rounded-full border px-2.5 py-1', status === stage.key ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground')}>{stage.label}</span>{index < stages.length - 1 && <ChevronRight className="size-3 text-muted-foreground"/>}</span>)}</div>
}

function WeeklyGoals({ draft, setDraft }: { draft: AaaTopic; setDraft: (topic: AaaTopic) => void }) {
  const goals = draft.plan.weeklyGoals ?? []
  const setGoals = (next: string[]) => setDraft({ ...draft, plannedWeeks: next.length, plan: { ...draft.plan, weeklyGoals: next } })
  const insert = (index: number) => { if (goals.length < 10) setGoals([...goals.slice(0, index), '', ...goals.slice(index)]) }
  return <section><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">每周目标 · {goals.length} 周</h2><p className="mt-1 text-xs text-muted-foreground">最多 10 周。可在任意两周之间插入。</p></div><Button size="sm" variant="outline" disabled={goals.length >= 10} onClick={() => insert(goals.length)}><Plus className="mr-1 size-3"/>末尾添加</Button></div><div className="mt-3 space-y-1"><InsertWeek disabled={goals.length >= 10} onClick={() => insert(0)}/>{goals.map((goal, index) => <div key={index}><div className="flex items-start gap-2"><span className="w-16 shrink-0 pt-2 text-xs font-medium">Week {index + 1}</span><Textarea aria-label={`Week ${index + 1} 目标`} rows={2} value={goal} placeholder="本周要达到的具体目标" onChange={(event) => setGoals(goals.map((item, i) => i === index ? event.target.value : item))}/><Button type="button" size="icon" variant="ghost" aria-label={`删除 Week ${index + 1}`} onClick={() => setGoals(goals.filter((_, i) => i !== index))}><X className="size-4"/></Button></div><InsertWeek disabled={goals.length >= 10} onClick={() => insert(index + 1)}/></div>)}</div></section>
}
function InsertWeek({ disabled, onClick }: { disabled: boolean; onClick: () => void }) { return <div className="pl-16"><button type="button" disabled={disabled} onClick={onClick} className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-30">＋ 在此插入一周</button></div> }

function ExitForm({ topic, action, onClose, onSubmit }: { topic: AaaTopic; action: 'accept' | 'freeze' | 'cancel'; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const label = { accept: '验收', freeze: '冻结', cancel: '撤销' }[action]
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><form onSubmit={(event) => { event.preventDefault(); setBusy(true); void onSubmit(reason).catch((cause) => setError(cause instanceof Error ? cause.message : '操作失败')).finally(() => setBusy(false)) }} className="w-full max-w-md space-y-4 rounded-xl border bg-background p-5 shadow-xl"><h2 className="font-semibold">{label} · {topic.title}</h2><p className="text-xs text-muted-foreground">{action === 'freeze' ? '冻结后回到 Registry，后续需要重新评审。' : '提交后进入馆藏并保留记录。'}</p><LabelArea label="结论 / 原因" value={reason} onChange={setReason}/>{error && <p className="text-xs text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="submit" disabled={!reason.trim() || busy}>确认{label}</Button></div></form></div>
}

function WorkingWeek({ topic, week, currentWeek, onMutate }: { topic: AaaTopic; week: number; currentWeek: number; onMutate: Mutation }) {
  return <div className="mx-auto max-w-4xl p-4 sm:p-7"><header className="border-b pb-5"><p className="text-xs text-muted-foreground">{topic.title} · Working</p><h1 className="mt-2 text-2xl font-semibold">Week {week}{week === currentWeek && <span className="ml-2 rounded-full bg-foreground px-2 py-1 align-middle text-xs text-background">当前周</span>}</h1><p className="mt-1 text-sm text-muted-foreground">{week > (topic.plannedWeeks ?? 0) ? `已超出原定 ${topic.plannedWeeks} 周计划` : `第 ${week} / ${topic.plannedWeeks} 周`}</p><div className="mt-4"><Lifecycle status={topic.status}/></div></header><section className="mt-6 rounded-xl border bg-card p-5"><h2 className="text-xs font-semibold text-muted-foreground">本周目标</h2><p className="mt-2 whitespace-pre-wrap text-base">{topic.plan.weeklyGoals?.[week - 1] || '本周没有预设目标'}</p></section><WeekNotes topic={topic} week={week} onMutate={onMutate}/><section className="mt-6 grid gap-3 sm:grid-cols-2"><ReadField label="预期成果" value={topic.plan.expectedOutcome}/><ReadField label="验收标准" value={topic.plan.closingCriteria}/></section><WorkingTodos topicId={topic.id}/></div>
}

function WeekNotes({ topic, week, onMutate }: { topic: AaaTopic; week: number; onMutate: Mutation }) {
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const notes = currentCycleNotes(topic).filter((entry) => entry.week === week)
  const submit = async () => {
    if (!content.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await onMutate(() => writeRequest<AaaTopic>(`/api/aaa/topics/${topic.id}/week-notes`, { week, content }))
      setContent('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '备注保存失败') }
    finally { setBusy(false) }
  }
  return <section className="mt-6 rounded-xl border p-4"><div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold">Week {week} 备注</h2><span className="text-xs text-muted-foreground">{notes.length} 条</span></div><div className="mt-3 space-y-2">{notes.map((note) => <div key={note.id} className="rounded-lg bg-muted/50 p-3"><p className="whitespace-pre-wrap text-sm">{note.content}</p><time className="mt-2 block text-[10px] text-muted-foreground">{new Date(note.createdAt).toLocaleString('zh-CN')}</time></div>)}{!notes.length && <p className="text-xs text-muted-foreground">本周还没有备注。</p>}</div><div className="mt-4 space-y-2"><Textarea aria-label={`Week ${week} 新备注`} value={content} onChange={(event) => setContent(event.target.value)} placeholder="记下本周进展、发现或需要回看的事项" rows={3}/>{error && <p className="text-xs text-destructive">{error}</p>}<div className="flex justify-end"><Button size="sm" disabled={!content.trim() || busy} onClick={() => void submit()}>{busy ? '保存中…' : '添加备注'}</Button></div></div></section>
}

function WorkingNoteHistory({ topic }: { topic: AaaTopic }) {
  const notes = topic.entries.filter((entry) => entry.kind === 'weekly_note' && (topic.status !== 'working' || !topic.workingStartedAt || entry.createdAt < topic.workingStartedAt))
  if (!notes.length) return null
  return <section className="mt-6 rounded-lg border p-4"><h2 className="text-sm font-semibold">历史 Working 备注</h2><div className="mt-3 space-y-2">{notes.map((note) => <div key={note.id} className="rounded-md bg-muted/50 p-3"><p className="text-xs font-medium">Week {note.week} · {new Date(note.createdAt).toLocaleString('zh-CN')}</p><p className="mt-1 whitespace-pre-wrap text-sm">{note.content}</p></div>)}</div></section>
}

function ArchivePage({ topics, onSelect }: { topics: AaaTopic[]; onSelect: (id: string) => void }) {
  return <div className="mx-auto max-w-5xl p-4 sm:p-7"><h1 className="text-xl font-semibold">馆藏</h1><p className="mt-1 text-sm text-muted-foreground">已验收或撤销的 Topic。</p><div className="mt-6 grid gap-3 sm:grid-cols-2">{topics.map((topic) => <button key={topic.id} onClick={() => onSelect(topic.id)} className="rounded-xl border bg-card p-4 text-left hover:bg-muted"><h2 className="font-semibold">{topic.title}</h2><p className="mt-1 text-xs text-muted-foreground">{topic.exitType === 'closing' ? '已验收' : '已撤销'} · {topic.completionRating ?? '未评价'}</p></button>)}</div>{!topics.length && <p className="mt-6 text-sm text-muted-foreground">暂无馆藏 Topic。</p>}</div>
}
function ArchiveFields({ draft, setDraft }: { draft: AaaTopic; setDraft: (topic: AaaTopic) => void }) {
  const distinctions = ['I', 'II', 'III', 'IV', 'V'] as const
  return <section className="mt-7 rounded-lg border p-4"><h2 className="text-sm font-semibold">Closing</h2><p className="mt-1 text-xs text-muted-foreground">出口：{draft.exitType} · {draft.exitedAt ? new Date(draft.exitedAt).toLocaleDateString('zh-CN') : '未记录'}</p><label className="mt-3 block text-xs font-medium">Completion Rating<select className="mt-1 block h-9 w-full rounded-md border bg-background px-2" value={draft.completionRating ?? ''} onChange={(event) => setDraft({ ...draft, completionRating: event.target.value as AaaTopic['completionRating'] })}><option value="">未评价</option><option value="insufficient">不足</option><option value="barely">勉强</option><option value="complete">完成</option><option value="platinum">白金</option></select></label><div className="mt-3 flex flex-wrap gap-2">{distinctions.map((value) => <button type="button" key={value} onClick={() => setDraft({ ...draft, distinctions: draft.distinctions.includes(value) ? draft.distinctions.filter((item) => item !== value) : [...draft.distinctions, value] })} className={cn('rounded-full border px-3 py-1 text-xs', draft.distinctions.includes(value) && 'bg-foreground text-background')}>{value}</button>)}</div></section>
}
function LabelText({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block text-xs font-medium">{label}<Input className="mt-1" value={value} onChange={(event) => onChange(event.target.value)}/></label> }
function LabelArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block text-xs font-medium">{label}<Textarea className="mt-1 min-h-24" value={value} onChange={(event) => onChange(event.target.value)}/></label> }
function ReadField({ label, value }: { label: string; value?: string }) { return <div className="rounded-lg border p-3"><p className="text-xs font-semibold text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm">{value || '—'}</p></div> }
