// ⚠️ 本文件刻意 **不加** `'use server'`。
// 它是服务层，导出了 `PinLockError`（类）以及 `recordLoginFailure` / `recordLoginSuccess`
// （同步函数）；而 `'use server'` 文件只允许导出 async 函数，否则 Next 构建会报
// "Only async functions are allowed to be exported in a \"use server\" file"。
// server action 的边界在 `app/actions/auth.ts`，由它包装这些服务层函数。
import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignJWT, jwtVerify } from 'jose'
import {
  SetupPinSchema,
  UnlockPinSchema,
  UpdatePinSchema,
  type PinFieldErrors,
  type SessionPayload,
} from './auth.types'
import {
  getPinEpoch,
  isPinConfigured,
  savePin,
  verifyStoredPin,
} from './pin.service'
import {
  clearSignal,
  describeRemaining,
  describeSignal,
  lockedFor,
  recordFailure,
  recordFailureSignal,
  recordSuccess,
} from '@/lib/backoff'

function sessionKey(): Uint8Array | undefined {
  const secret = process.env['SESSION_SECRET']
  if (!secret) return
  return new TextEncoder().encode(secret)
}

function endOfLocalDay(now = new Date()): Date {
  const expiresAt = new Date(now)
  expiresAt.setHours(24, 0, 0, 0)
  return expiresAt
}

export async function encrypt(payload: SessionPayload) {
  const key = sessionKey()
  if (!key) throw new Error('SESSION_SECRET is not set')

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(payload.expiresAt)
    .sign(key)
}

export async function decrypt(session: string | undefined = '') {
  const key = sessionKey()
  if (!key) return

  try {
    const { payload } = await jwtVerify(session, key, {
      algorithms: ['HS256'],
    })
    return {
      expiresAt: payload.expiresAt as SessionPayload['expiresAt'],
      pinEpoch: typeof payload.pinEpoch === 'string' ? payload.pinEpoch : '',
    }
  } catch {
    return
  }
}

export async function verifySessionGuard() {
  return requireAppAccess()
}

export async function requireAppAccess() {
  if (!(await isPinConfigured())) {
    redirect('/login')
  }

  const session = await verifySession()
  if (!session.isAuth) {
    redirect('/login')
  }

  return session
}

export const verifySession = async () => {
  const cookie = (await cookies()).get('session')?.value
  if (!cookie) {
    return { isAuth: false as const }
  }

  const session = await decrypt(cookie)
  const pinEpoch = await getPinEpoch()

  if (!session || !pinEpoch || session.pinEpoch !== pinEpoch) {
    return { isAuth: false as const }
  }

  return { isAuth: true as const, expiresAt: session.expiresAt, pinEpoch }
}

export async function createSession() {
  const pinEpoch = (await getPinEpoch()) ?? ''
  const expiresAt = endOfLocalDay()
  const jwt = await encrypt({ expiresAt, pinEpoch })
  const userCookies = await cookies()
  userCookies.set('session', jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  })
}

export async function updateSession() {
  const session = (await cookies()).get('session')?.value
  const payload = await decrypt(session)

  if (!session || !payload) {
    return null
  }

  const expires = endOfLocalDay()

  const cookieStore = await cookies()
  cookieStore.set('session', session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expires,
    sameSite: 'lax',
    path: '/',
  })
}

export async function deleteSession() {
  ;(await cookies()).delete('session')
}

/**
 * ⚠️ **ownspire-navi 与其他三个项目的差异**：这里是 server action，拿不到 `Request` 对象，
 * 所以 IP 要从 `headers()` 里读。取值口径与其他三个项目一致（XFF 第一个值）。
 */
async function clientKey(): Promise<string> {
  const requestHeaders = await headers()
  const forwarded = requestHeaders.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return requestHeaders.get('x-real-ip') ?? 'local'
}

/**
 * 退避锁定的剩余毫秒。0 = 未锁定。
 *
 * 供 server action 与界面读取 —— **锁定期间必须能看到还剩多久**，
 * 否则用户只会看到「PIN 不正确」，然后反复重试，每次都被更快地拒。
 */
export async function lockRemainingMs(): Promise<number> {
  return lockedFor(await clientKey())
}

export async function setupPin(
  input: unknown
): Promise<{ ok: true } | { ok: false; errors: PinFieldErrors }> {
  const key = await clientKey()
  assertNotRateLimited(key)
  if (await isPinConfigured()) {
    return { ok: false, errors: { pin: ['PIN 已设置，请直接解锁'] } }
  }

  const parsed = SetupPinSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }

  await savePin(parsed.data.pin)
  recordLoginSuccess(key)
  await createSession()
  return { ok: true }
}

export async function loginWithPin(
  input: unknown
): Promise<{ ok: true } | { ok: false; errors: PinFieldErrors }> {
  const key = await clientKey()
  assertNotRateLimited(key)
  if (!(await isPinConfigured())) {
    return { ok: false, errors: { pin: ['尚未设置 PIN'] } }
  }

  const parsed = UnlockPinSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }

  const valid = await verifyStoredPin(parsed.data.pin)
  if (!valid) {
    recordLoginFailure(key)
    return { ok: false, errors: { pin: ['PIN 不正确'] } }
  }

  recordLoginSuccess(key)
  await createSession()
  return { ok: true }
}

export async function updatePin(
  input: unknown
): Promise<{ ok: true } | { ok: false; errors: PinFieldErrors }> {
  const key = await clientKey()
  assertNotRateLimited(key)
  if (!(await isPinConfigured())) {
    return { ok: false, errors: { currentPin: ['尚未设置 PIN'] } }
  }

  const parsed = UpdatePinSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }

  const valid = await verifyStoredPin(parsed.data.currentPin)
  if (!valid) {
    recordLoginFailure(key)
    return { ok: false, errors: { currentPin: ['当前 PIN 不正确'] } }
  }

  await savePin(parsed.data.pin)
  recordLoginSuccess(key)
  await createSession()
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 指数退避
// ---------------------------------------------------------------------------

/**
 * 退避锁定的错误。ownspire-navi 的三个动作返回 `{ok:false, errors}` 而不是抛异常
 * （server action 的约定），所以这里把「被锁定」也表达成 errors 里的一个字段，
 * 由界面读 `lockRemainingMs()` 显示剩余时间。
 *
 * ⚠️ 锁定期内的请求**不会**增加失败计数 —— 否则一直点就能把锁定顶到 24 小时
 * 上限且再也解不开。
 */
function assertNotRateLimited(key: string): void {
  const remaining = lockedFor(key)
  if (remaining <= 0) return
  // 抛出去而不是返回 errors：与另外三个项目的行为一致，而且
  // 「被锁定」和「PIN 错了」在界面上要说不同的话。
  throw new PinLockError(describeRemaining(remaining), remaining)
}

export class PinLockError extends Error {
  readonly remainingMs: number
  constructor(message: string, remainingMs: number) {
    super(message)
    this.name = 'PinLockError'
    this.remainingMs = remainingMs
  }
}

/** 记一次失败，施加指数退避，并在判定可疑时打一行日志。 */
export function recordLoginFailure(key: string): void {
  recordFailure(key)
  const signal = recordFailureSignal(key)
  if (signal.suspicious) {
    // ⚠️ 走 console.warn 而不是静默：这是「感知到有人在重试」的唯一出口。
    console.warn(describeSignal(signal, key))
  }
}

/** 登录成功 —— 退避计数与攻击信号**一起**清空。 */
export function recordLoginSuccess(key: string): void {
  recordSuccess(key)
  clearSignal(key)
}
