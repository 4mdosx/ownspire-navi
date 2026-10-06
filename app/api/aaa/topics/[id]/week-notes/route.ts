import { NextRequest, NextResponse } from 'next/server'
import { addAaaWeekNote } from '@/backstage/aaa/aaa.service'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const data = await addAaaWeekNote((await params).id, await request.json())
    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '备注保存失败' }, { status: 400 })
  }
}
