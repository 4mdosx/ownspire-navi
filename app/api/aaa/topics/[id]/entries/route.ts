import { NextRequest, NextResponse } from 'next/server'
import { addAaaEntry } from '@/backstage/aaa/aaa.service'
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json({ success: true, data: await addAaaEntry((await params).id, await request.json()) }, { status: 201 }) }
  catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '记录失败' }, { status: 400 }) }
}
