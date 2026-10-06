import { NextRequest, NextResponse } from 'next/server'
import { createAaaTopic, listAaaTopics } from '@/backstage/aaa/aaa.service'

const message = (error: unknown) => error instanceof Error ? error.message : 'AAA 请求失败'
export async function GET() { try { return NextResponse.json({ success: true, data: await listAaaTopics() }) } catch (e) { return NextResponse.json({ success: false, error: message(e) }, { status: 400 }) } }
export async function POST(request: NextRequest) { try { return NextResponse.json({ success: true, data: await createAaaTopic(await request.json()) }, { status: 201 }) } catch (e) { return NextResponse.json({ success: false, error: message(e) }, { status: 400 }) } }
