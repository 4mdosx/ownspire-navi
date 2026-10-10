'use server'
import 'server-only'

import {
  deleteSession,
  loginWithPin,
  PinLockError,
  setupPin,
  updatePin,
} from '@/backstage/service/auth.service'
import type {
  SetupPinInput,
  UnlockPinInput,
  UpdatePinInput,
} from '@/backstage/service/auth.types'
import { redirect } from 'next/navigation'

/**
 * 三个动作的薄封装。
 *
 * ⚠️ **退避锁定的错误必须在这里接住并转成 `errors`**：service 层抛的是
 * `PinLockError`，而界面读的是 `{ errors }`。不接的话被锁定时会看到一个
 * 未捕获的异常页面 —— 而用户此时只需要知道「还要等多久」。
 */
function toErrors(error: unknown): { errors: Record<string, string[]> } {
  if (error instanceof PinLockError) {
    // 挂在 `pin` 字段上：界面把它贴在 PIN 输入框下面，正好是最需要这条信息的地方。
    return { errors: { pin: [error.message] } }
  }
  throw error
}

export async function setupAccessPin(input: SetupPinInput) {
  try {
    const result = await setupPin(input)
    if (!result.ok) {
      return { errors: result.errors }
    }
  } catch (error) {
    return toErrors(error)
  }
  redirect('/')
}

export async function unlockWithPin(input: UnlockPinInput) {
  try {
    const result = await loginWithPin(input)
    if (!result.ok) {
      return { errors: result.errors }
    }
  } catch (error) {
    return toErrors(error)
  }
  redirect('/')
}

export async function updateAccessPin(input: UpdatePinInput) {
  try {
    const result = await updatePin(input)
    if (!result.ok) {
      return { errors: result.errors }
    }
    return { ok: true as const }
  } catch (error) {
    return toErrors(error)
  }
}

export async function logout() {
  await deleteSession()
  redirect('/')
}