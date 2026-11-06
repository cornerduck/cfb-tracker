// Push notifications for STRDYS, loaded into the generated service worker.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const scope = self.registration.scope
  event.waitUntil(self.registration.showNotification(data.title || 'STRDYS', {
    body: data.body || '',
    tag: data.tag || undefined,
    // The final replaces the kickoff of the same game and still alerts.
    renotify: Boolean(data.tag),
    icon: scope + 'icon-192.png',
    data: { url: new URL(data.url || '', scope).href, gameId: data.gameId ?? null },
  }))
})

// A tap opens the game: in the open app, or by starting the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { url, gameId } = event.notification.data || {}
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find((client) => client.url.startsWith(self.registration.scope))
    if (open) {
      await open.focus()
      if (gameId) open.postMessage({ type: 'strdys-open-game', gameId })
      return
    }
    await self.clients.openWindow(url || self.registration.scope)
  })())
})
