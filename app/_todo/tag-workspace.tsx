'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { INCLUDE_ALL, type FocusMode, type Tag } from '@/types/tag'
import type { Todo } from '@/types/todo'

const ACTIVE_FOCUS_KEY = 'ownspire-navi-active-focus-mode'

type CreateFocusInput = {
  name: string
  includeTags?: string[]
  excludeTags?: string[]
}

type TagWorkspaceValue = {
  tags: Tag[]
  focusModes: FocusMode[]
  activeFocusModeId: string | null
  activeFocusMode: FocusMode | null
  refreshTags: () => Promise<void>
  refreshFocusModes: () => Promise<void>
  createTag: (name: string) => Promise<Tag>
  updateTag: (id: string, name: string) => Promise<Tag>
  deleteTag: (id: string) => Promise<void>
  setTodoTags: (todoId: string, tagIds: string[]) => Promise<Todo>
  addTodoTag: (todoId: string, nameOrId: { name?: string; tagId?: string }) => Promise<Todo>
  removeTodoTag: (todoId: string, tagId: string) => Promise<void>
  createFocusMode: (input: CreateFocusInput) => Promise<FocusMode>
  updateFocusMode: (id: string, input: CreateFocusInput) => Promise<FocusMode>
  deleteFocusMode: (id: string) => Promise<void>
  setActiveFocusModeId: (id: string | null) => void
}

const TagWorkspaceContext = createContext<TagWorkspaceValue | null>(null)

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init })
  const result = await response.json() as { success?: boolean; data?: T; error?: string }
  if (!response.ok || result.success === false) throw new Error(result.error || '请求失败')
  return result.data as T
}

function readActiveFocusModeId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_FOCUS_KEY)
  } catch {
    return null
  }
}

function writeActiveFocusModeId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_FOCUS_KEY, id)
    else localStorage.removeItem(ACTIVE_FOCUS_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}

export function TagWorkspaceProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<Tag[]>([])
  const [focusModes, setFocusModes] = useState<FocusMode[]>([])
  const [activeFocusModeId, setActiveId] = useState<string | null>(null)

  const refreshTags = useCallback(async () => {
    setTags(await jsonRequest<Tag[]>('/api/tags'))
  }, [])

  const refreshFocusModes = useCallback(async () => {
    setFocusModes(await jsonRequest<FocusMode[]>('/api/focus-modes'))
  }, [])

  useEffect(() => {
    setActiveId(readActiveFocusModeId())
    void refreshTags().catch(() => undefined)
    void refreshFocusModes().catch(() => undefined)
  }, [refreshTags, refreshFocusModes])

  const setActiveFocusModeId = useCallback((id: string | null) => {
    setActiveId(id)
    writeActiveFocusModeId(id)
  }, [])

  useEffect(() => {
    if (activeFocusModeId && focusModes.length > 0 && !focusModes.some((mode) => mode.id === activeFocusModeId)) {
      setActiveFocusModeId(null)
    }
  }, [activeFocusModeId, focusModes, setActiveFocusModeId])

  const createTag = useCallback(async (name: string) => {
    const tag = await jsonRequest<Tag>('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    await refreshTags()
    return tag
  }, [refreshTags])

  const updateTag = useCallback(async (id: string, name: string) => {
    const tag = await jsonRequest<Tag>(`/api/tags/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    await Promise.all([refreshTags(), refreshFocusModes()])
    return tag
  }, [refreshTags, refreshFocusModes])

  const deleteTag = useCallback(async (id: string) => {
    await jsonRequest(`/api/tags/${encodeURIComponent(id)}`, { method: 'DELETE' })
    await Promise.all([refreshTags(), refreshFocusModes()])
  }, [refreshTags, refreshFocusModes])

  const setTodoTags = useCallback(async (todoId: string, tagIds: string[]) => {
    return jsonRequest<Todo>(`/api/todos/${encodeURIComponent(todoId)}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagIds }),
    })
  }, [])

  const addTodoTag = useCallback(async (todoId: string, nameOrId: { name?: string; tagId?: string }) => {
    const todo = await jsonRequest<Todo>(`/api/todos/${encodeURIComponent(todoId)}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nameOrId),
    })
    await refreshTags()
    return todo
  }, [refreshTags])

  const removeTodoTag = useCallback(async (todoId: string, tagId: string) => {
    await jsonRequest(`/api/todos/${encodeURIComponent(todoId)}/tags?tagId=${encodeURIComponent(tagId)}`, {
      method: 'DELETE',
    })
  }, [])

  const createFocusMode = useCallback(async (input: CreateFocusInput) => {
    const mode = await jsonRequest<FocusMode>('/api/focus-modes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        includeTags: input.includeTags ?? [INCLUDE_ALL],
        excludeTags: input.excludeTags ?? [],
      }),
    })
    await refreshFocusModes()
    return mode
  }, [refreshFocusModes])

  const updateFocusMode = useCallback(async (id: string, input: CreateFocusInput) => {
    const mode = await jsonRequest<FocusMode>(`/api/focus-modes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    await refreshFocusModes()
    return mode
  }, [refreshFocusModes])

  const deleteFocusMode = useCallback(async (id: string) => {
    await jsonRequest(`/api/focus-modes/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (activeFocusModeId === id) setActiveFocusModeId(null)
    await refreshFocusModes()
  }, [activeFocusModeId, refreshFocusModes, setActiveFocusModeId])

  const activeFocusMode = useMemo(
    () => focusModes.find((mode) => mode.id === activeFocusModeId) ?? null,
    [focusModes, activeFocusModeId],
  )

  const value = useMemo<TagWorkspaceValue>(() => ({
    tags,
    focusModes,
    activeFocusModeId,
    activeFocusMode,
    refreshTags,
    refreshFocusModes,
    createTag,
    updateTag,
    deleteTag,
    setTodoTags,
    addTodoTag,
    removeTodoTag,
    createFocusMode,
    updateFocusMode,
    deleteFocusMode,
    setActiveFocusModeId,
  }), [
    tags, focusModes, activeFocusModeId, activeFocusMode,
    refreshTags, refreshFocusModes, createTag, updateTag, deleteTag,
    setTodoTags, addTodoTag, removeTodoTag, createFocusMode, updateFocusMode, deleteFocusMode,
    setActiveFocusModeId,
  ])

  return <TagWorkspaceContext.Provider value={value}>{children}</TagWorkspaceContext.Provider>
}

export function useTagWorkspace() {
  const value = useContext(TagWorkspaceContext)
  if (!value) throw new Error('useTagWorkspace must be used within TagWorkspaceProvider')
  return value
}
