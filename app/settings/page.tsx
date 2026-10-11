import { Suspense } from 'react'
import { requireAppAccess } from '@/backstage/service/auth.service'
import { getPinStatus } from '@/backstage/service/pin.service'
import SettingsWorkspace from './settings-workspace'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '设置 · Ownspire Navi',
}

export default async function SettingsPage() {
  await requireAppAccess()
  const pin = await getPinStatus()

  return (
    <Suspense>
      <SettingsWorkspace pinUpdatedAt={pin.updatedAt} />
    </Suspense>
  )
}
