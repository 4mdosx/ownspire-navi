import { NextRequest, NextResponse } from 'next/server'
import { deleteAaaTopic, getAaaTopic, updateAaaTopic } from '@/backstage/aaa/aaa.service'
const message = (error: unknown) => error instanceof Error ? error.message : 'AAA 请求失败'
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) { try { return NextResponse.json({ success: true, data: await getAaaTopic((await params).id) }) } catch (e) { return NextResponse.json({ success: false, error: message(e) }, { status: 404 }) } }
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { try { return NextResponse.json({ success: true, data: await updateAaaTopic((await params).id, await request.json()) }) } catch (e) { return NextResponse.json({ success: false, error: message(e) }, { status: 400 }) } }
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) { try { await deleteAaaTopic((await params).id); return NextResponse.json({ success: true }) } catch (e) { return NextResponse.json({ success: false, error: message(e) }, { status: 400 }) } }
