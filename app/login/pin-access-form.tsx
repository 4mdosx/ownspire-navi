'use client'

import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import PinInput from './components/pin-input'
import { AnimatePresence, motion } from 'framer-motion'
import { KeyRound } from 'lucide-react'
import { setupAccessPin, unlockWithPin } from '../actions/auth'
import { PIN_LENGTH } from '@/backstage/service/auth.types'

export default function PinAccessForm({
  mode,
}: {
  mode: 'setup' | 'unlock'
}) {
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinReset, setPinReset] = useState(0)
  const [confirmReset, setConfirmReset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({})

  const firstError =
    errors.pin?.[0] || errors.confirmPin?.[0] || errors.currentPin?.[0]

  const submitSetup = async (nextPin = pin, nextConfirm = confirmPin) => {
    if (nextPin.length !== PIN_LENGTH || nextConfirm.length !== PIN_LENGTH) return
    setLoading(true)
    setErrors({})
    const result = await setupAccessPin({ pin: nextPin, confirmPin: nextConfirm })
    if (result?.errors) {
      setErrors(result.errors)
      setConfirmPin('')
      setConfirmReset((value) => value + 1)
    }
    setLoading(false)
  }

  const submitUnlock = async (nextPin: string) => {
    if (nextPin.length !== PIN_LENGTH) return
    setLoading(true)
    setErrors({})
    const result = await unlockWithPin({ pin: nextPin })
    if (result?.errors) {
      setErrors(result.errors)
      setPin('')
      setPinReset((value) => value + 1)
    }
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-md"
        >
          <Card className="border-none shadow-lg">
            <CardHeader className="space-y-1">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <KeyRound className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-center text-2xl">
                {mode === 'setup' ? '设置访问 PIN' : '输入 PIN'}
              </CardTitle>
<CardDescription className="text-center">
              {mode === 'setup'
                ? `首次使用请设置 ${PIN_LENGTH} 位 PIN。解锁后当天有效，次日需再输入。`
                : `输入 ${PIN_LENGTH} 位 PIN。解锁后当天有效。`}
            </CardDescription>
            {/*
              ⚠️ 退避规则要写在界面上：**指数退避下被锁定是正常结果，不是故障**。
              不说的话用户只会以为「PIN 不正确」是自己输错了，于是反复重试 ——
              而每次重试都会被拒得更久，最终锁死 24 小时。
            */}
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              PIN 输错会触发指数退避：越错等得越久，最长锁 24 小时。
            </p>
          </CardHeader>
            <CardContent className="space-y-6">
              {mode === 'setup' ? (
                <>
                  <div className="space-y-2">
                    <Label className="block text-center">新 PIN</Label>
                    <PinInput
                      key={`pin-${pinReset}`}
                      disabled={loading}
                      onChange={setPin}
                      onComplete={(value) => {
                        setPin(value)
                        if (confirmPin.length === PIN_LENGTH) {
                          void submitSetup(value, confirmPin)
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="block text-center">确认 PIN</Label>
                    <PinInput
                      key={`confirm-${confirmReset}`}
                      autoFocus={false}
                      disabled={loading}
                      onChange={setConfirmPin}
                      onComplete={(value) => {
                        setConfirmPin(value)
                        if (pin.length === PIN_LENGTH) {
                          void submitSetup(pin, value)
                        }
                      }}
                    />
                  </div>
                </>
              ) : (
                <PinInput
                  key={`unlock-${pinReset}`}
                  disabled={loading}
                  onChange={setPin}
                  onComplete={(value) => {
                    setPin(value)
                    void submitUnlock(value)
                  }}
                />
              )}
            </CardContent>
            <CardFooter className="flex flex-col space-y-4">
              {mode === 'setup' && (
                <Button
                  className="w-full"
                  disabled={loading || pin.length !== PIN_LENGTH || confirmPin.length !== PIN_LENGTH}
                  onClick={() => void submitSetup()}
                >
                  {loading ? '保存中…' : '保存 PIN'}
                </Button>
              )}
              {firstError && <p className="text-red-500">{firstError}</p>}
            </CardFooter>
          </Card>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
