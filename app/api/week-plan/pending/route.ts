import { NextRequest, NextResponse } from 'next/server'
import {
  createPendingActivity,
  deletePendingActivity,
  updatePendingActivity,
} from '@/backstage/week-plan/week-plan.service'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { title, estimatedHours, aaaTopicId } = body
    if (!title || typeof title !== 'string') {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }
    const pending = await createPendingActivity({
      title,
      estimatedHours: estimatedHours != null ? Number(estimatedHours) : undefined,
      aaaTopicId: aaaTopicId ? String(aaaTopicId) : null,
    })
    return NextResponse.json({ success: true, pending })
  } catch (error) {
    console.error('Error creating pending activity:', error)
    return NextResponse.json(
      { error: 'Failed to create pending activity' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, title, estimatedHours } = body
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    const pending = await updatePendingActivity(id, {
      title: title != null ? String(title) : undefined,
      estimatedHours: estimatedHours != null ? Number(estimatedHours) : undefined,
    })
    return NextResponse.json({ success: true, pending })
  } catch (error) {
    console.error('Error updating pending activity:', error)
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return NextResponse.json(
      { error: 'Failed to update pending activity' },
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
    await deletePendingActivity(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting pending activity:', error)
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return NextResponse.json(
      { error: 'Failed to delete pending activity' },
      { status: 500 }
    )
  }
}
