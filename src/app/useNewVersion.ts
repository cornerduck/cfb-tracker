import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// A new deploy is detected while the app is open: it checks hourly and every
// time it comes back to the foreground. The banner then reloads it in one tap.
export function useNewVersion() {
  const registration = useRef<ServiceWorkerRegistration | null>(null)
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, swRegistration) {
      registration.current = swRegistration ?? null
    },
  })

  useEffect(() => {
    const check = () => {
      if (navigator.onLine) void registration.current?.update().catch(() => undefined)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    const interval = window.setInterval(check, 60 * 60 * 1000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return { newVersion: needRefresh, reload: () => void updateServiceWorker(true) }
}
