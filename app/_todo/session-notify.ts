import { isRestKind, type Todo } from '@/types/todo'
import { sessionLimitMinutes } from '@/lib/todo-session'

export async function ensureNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

export function notifySessionEnded(todo: Pick<Todo, 'id' | 'kind' | 'title'>) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  const rest = isRestKind(todo.kind)
  const minutes = sessionLimitMinutes(todo.kind)
  new Notification(rest ? '休息结束' : '任务结束', {
    body: rest ? `${minutes} 分钟到了。` : `「${todo.title}」已到 ${minutes} 分钟。`,
    tag: rest ? 'ownspire-navi-rest-ended' : `ownspire-navi-task-ended-${todo.id}`,
  })
}
