import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type PushState = 'loading' | 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

const supported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// iPhone and iPad only allow notifications for apps added to the Home Screen.
const needsInstall = () => {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios && !standalone
}

const keyBytes = (base64: string) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

const deviceName = () => {
  const agent = navigator.userAgent
  if (/iPhone/.test(agent)) return 'iPhone'
  if (/iPad/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/Android/.test(agent)) return 'Android'
  if (/Mac/.test(agent)) return 'Mac'
  if (/Windows/.test(agent)) return 'Windows'
  return 'Browser'
}

const saveSubscription = async (subscription: PushSubscription) => {
  const json = subscription.toJSON()
  if (!supabase || !json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('The device could not be registered')
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('Sign in again to turn on notifications')
  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: json.endpoint,
    user_id: data.user.id,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    device: deviceName(),
  }, { onConflict: 'endpoint' })
  if (error) throw new Error(error.message)
  return json.endpoint
}

const sendTest = async (endpoint?: string) => {
  if (!supabase) return
  const { data, error } = await supabase.functions.invoke('push', { body: { action: 'test', endpoint } })
  if (error) throw new Error('The test notification could not be sent')
  if (!(data as { sent?: number }).sent) throw new Error('The test notification did not reach this device')
}

// Turns notifications on and off for this device. Turning them on sends a
// one-time test notification.
export function usePushNotifications() {
  const [state, setState] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    const check = async () => {
      if (!supported()) return needsInstall() ? 'needs-install' : 'unsupported'
      if (Notification.permission === 'denied') return 'denied'
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      if (!subscription || Notification.permission !== 'granted') return 'off'
      // Keeps the stored device current (for example after signing in again).
      await saveSubscription(subscription).catch(() => undefined)
      return 'on'
    }
    void check().then((next) => active && setState(next)).catch(() => active && setState('off'))
    return () => {
      active = false
    }
  }, [])

  const enable = useCallback(async () => {
    setBusy(true)
    setMessage('')
    try {
      // Safari only shows the permission prompt when it is asked first in the tap.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      if (!supabase) throw new Error('Supabase is not configured')
      const { data, error } = await supabase.functions.invoke('push', { method: 'GET' })
      const publicKey = (data as { public_key?: string } | null)?.public_key
      if (error || !publicKey) throw new Error('The notification key could not be loaded')
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription() ??
        await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
      const endpoint = await saveSubscription(subscription)
      setState('on')
      await sendTest(endpoint)
      setMessage('Notifications are on. A test notification is on its way.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Notifications could not be turned on')
    } finally {
      setBusy(false)
    }
  }, [])

  const disable = useCallback(async () => {
    setBusy(true)
    setMessage('')
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await supabase?.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
        await subscription.unsubscribe()
      }
      setState('off')
      setMessage('Notifications are off on this device.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Notifications could not be turned off')
    } finally {
      setBusy(false)
    }
  }, [])

  const test = useCallback(async () => {
    setBusy(true)
    setMessage('')
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      await sendTest(subscription?.endpoint)
      setMessage('Test notification sent.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The test notification could not be sent')
    } finally {
      setBusy(false)
    }
  }, [])

  return { state, busy, message, enable, disable, test }
}
