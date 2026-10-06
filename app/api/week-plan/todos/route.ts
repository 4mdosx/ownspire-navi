import { NextRequest, NextResponse } from 'next/server'
import {
  addTodoFromPendingActivity,
  completeWeekPlanTodo,
  createWeekPlanTodo,
  createWeekPlanTodoTree,
  deleteWeekPlanTodo,
  moveTodoToPending,
  startWeekPlanTodo,
} from '@/backstage/week-plan/week-plan.service'
import type { TodoStatus } from '@/types/week-plan'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    if (action === 'fromPending') {
      const { id, title, day, dayIndex, weekStart } = body
      if (!id || !title || !weekStart || typeof dayIndex !== 'number') {
        return NextResponse.json({ error: 'Invalid fromPending payload' }, { status: 400 })
      }
      const result = await addTodoFromPendingActivity({
        id: String(id),
        title: String(title),
        day: Number(day) || 1,
        dayIndex,
        weekStart: String(weekStart),
      })
      return NextResponse.json({ success: true, ...result })
    }

    if (action === 'createTree') {
      const { dayIndex, weekStart, parent, subtasks, root } = body
      if (typeof dayIndex !== 'number' || !weekStart) {
        return NextResponse.json(
          { error: 'dayIndex and weekStart are required' },
          { status: 400 }
        )
      }
      const result = await createWeekPlanTodoTree({
        dayIndex,
        weekStart: String(weekStart),
        parent: parent ? { title: String(parent.title ?? ''), aaaTopicId: parent.aaaTopicId ? String(parent.aaaTopicId) : null } : undefined,
        subtasks: Array.isArray(subtasks)
          ? subtasks.map((s: { title?: string; estimatedHours?: number }) => ({
              title: String(s.title ?? ''),
              estimatedHours:
                s.estimatedHours != null ? Number(s.estimatedHours) : 0.5,
            }))
          : undefined,
        root: root
          ? {
              title: String(root.title ?? ''),
              estimatedHours:
                root.estimatedHours != null ? Number(root.estimatedHours) : 1,
              aaaTopicId: root.aaaTopicId ? String(root.aaaTopicId) : null,
            }
          : undefined,
      })
      return NextResponse.json({ success: true, ...result })
    }

    const { title, dayIndex, weekStart, estimatedHours, status, startedAtMs } = body
    if (!title || typeof dayIndex !== 'number' || !weekStart) {
      return NextResponse.json(
        { error: 'title, dayIndex and weekStart are required' },
        { status: 400 }
      )
    }

    const todo = await createWeekPlanTodo({
      title: String(title),
      dayIndex,
      weekStart: String(weekStart),
      estimatedHours: estimatedHours != null ? Number(estimatedHours) : undefined,
      status: status as TodoStatus | undefined,
      startedAtMs: startedAtMs != null ? Number(startedAtMs) : undefined,
    })

    return NextResponse.json({ success: true, todo })
  } catch (error) {
    console.error('Error creating week plan todo:', error)
    return NextResponse.json(
      { error: 'Failed to create week plan todo' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, action, weekStart } = body

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    if (action === 'start') {
      if (!weekStart) {
        return NextResponse.json({ error: 'weekStart is required' }, { status: 400 })
      }
      const todo = await startWeekPlanTodo(id, String(weekStart))
      return NextResponse.json({ success: true, todo })
    }

    if (action === 'complete') {
      const todo = await completeWeekPlanTodo(id)
      return NextResponse.json({ success: true, todo })
    }

    if (action === 'moveToPending') {
      const result = await moveTodoToPending(id)
      return NextResponse.json({ success: true, ...result })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('Error updating week plan todo:', error)
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return NextResponse.json(
      { error: 'Failed to update week plan todo' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { id } = body

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    await deleteWeekPlanTodo(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting week plan todo:', error)
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return NextResponse.json(
      { error: 'Failed to delete week plan todo' },
      { status: 500 }
    )
  }
}
