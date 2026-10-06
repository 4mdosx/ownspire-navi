import { NextRequest, NextResponse } from 'next/server'
import { transitionAaaTopic } from '@/backstage/aaa/aaa.service'
import type { AaaWorkflowAction } from '@/types/aaa'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json()
    const data = await transitionAaaTopic((await params).id, body.action as AaaWorkflowAction, body)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '阶段操作失败' }, { status: 400 })
  }
}
