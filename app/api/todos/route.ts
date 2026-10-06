import { NextRequest, NextResponse } from 'next/server'
import { createTodo, listTodos } from '@/backstage/todo/todo.service'
import { isTimeGrain, type TodoKind, type TodoStatus } from '@/types/todo'

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const parent = params.get('parentId')
    const grain = params.get('grain')
    const todos = await listTodos({
      status: (params.get('status') || undefined) as TodoStatus | undefined,
      kind: (params.get('kind') || undefined) as TodoKind | undefined,
      query: params.get('query') || undefined,
      parentId: parent === 'root' ? null : parent ?? undefined,
      grain: grain && isTimeGrain(grain) ? grain : undefined,
      date: params.get('date') || undefined,
      aaaTopicId: params.get('aaaTopicId') || undefined,
    })
    return NextResponse.json({ success: true, data: todos })
  } catch (error) {
    return NextResponse.json({ success: false, error: message(error) }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const todo = await createTodo(await request.json())
    return NextResponse.json({ success: true, data: todo }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ success: false, error: message(error) }, { status: 400 })
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Todo request failed'
}
