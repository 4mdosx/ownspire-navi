import { NextResponse } from 'next/server'
import { pingDatabase } from '@/backstage/db/database'

export const dynamic = 'force-dynamic'

export async function GET() {
  const version = process.env.OWNSPIRE_NAVI_VERSION ?? 'dev'
  try {
    await pingDatabase()
    return NextResponse.json({ ok: true, version })
  } catch {
    return NextResponse.json({ ok: false, version }, { status: 503 })
  }
}
