import { requireAppAccess } from '@/backstage/service/auth.service'
import AaaWorkspace from './workspace'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'AAA · Navi' }
export default async function AaaPage() { await requireAppAccess(); return <AaaWorkspace /> }
