import { usePushNotifications } from '../../app/usePushNotifications'

// Settings card: push notifications for this device.
export function NotificationsCard() {
  const push = usePushNotifications()
  const on = push.state === 'on'
  return (
    <section className="settings-card settings-push-card">
      <div className="settings-card-heading">
        <h3 className="cond">NOTIFICATIONS</h3>
        <span className={`settings-push-status cond${on ? ' on' : ''}`}>{on ? 'ON' : 'OFF'}</span>
      </div>
      <p>Kickoffs and finals of Top 25 games (AP Poll, CFP ranking once it is out) and of your teams. Each device is set up on its own.</p>
      {push.state === 'needs-install' && (
        <p>On iPhone and iPad, add STRDYS to the Home Screen first (Share, then Add to Home Screen) and open it from there.</p>
      )}
      {push.state === 'unsupported' && <p>This browser does not support notifications.</p>}
      {push.state === 'denied' && (
        <p>Notifications are blocked for STRDYS. Allow them in the system settings (iPhone: Settings, Notifications, STRDYS; Mac: System Settings, Notifications), then come back here.</p>
      )}
      {(push.state === 'off' || push.state === 'denied') && (
        <button type="button" className="primary-button cond" disabled={push.busy} onClick={() => void push.enable()}>
          {push.busy ? 'TURNING ON…' : 'TURN ON NOTIFICATIONS'}
        </button>
      )}
      {on && (
        <div className="settings-push-actions">
          <button type="button" className="outline-button cond" disabled={push.busy} onClick={() => void push.test()}>SEND TEST</button>
          <button type="button" className="outline-button cond" disabled={push.busy} onClick={() => void push.disable()}>TURN OFF</button>
        </div>
      )}
      {push.message && <p className="settings-push-message" role="status">{push.message}</p>}
    </section>
  )
}
