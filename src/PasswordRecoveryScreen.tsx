import { useState, type FormEvent } from 'react'

type PasswordRecoveryScreenProps = {
  loading: boolean
  error: string
  onSave: (password: string) => Promise<void>
}

function PasswordRecoveryScreen({ loading, error, onSave }: PasswordRecoveryScreenProps) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [validationError, setValidationError] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password.length < 8) {
      setValidationError('Choose a password with at least 8 characters.')
      return
    }
    if (password !== confirmation) {
      setValidationError('The passwords do not match.')
      return
    }
    setValidationError('')
    void onSave(password)
  }

  return (
    <main className="auth-screen">
      <div className="auth-brand">
        <span className="auth-brand-mark varsity">S</span>
        <span className="auth-brand-name cond">STRDYS</span>
        <span className="auth-private-label">Private</span>
      </div>
      <section className="auth-card">
        <div className="auth-card-heading">
          <h1 className="cond">RESET PASSWORD</h1>
          <span>Choose a new password for your account.</span>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label className="form-label">New password
            <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required disabled={loading} />
          </label>
          <label className="form-label">Confirm password
            <input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} required disabled={loading} />
          </label>
          {(validationError || error) && <p className="form-notice form-notice--error" role="alert">{validationError || error}</p>}
          <button className="auth-submit cond" type="submit" disabled={loading}>{loading ? 'SAVING…' : 'SAVE PASSWORD'}</button>
        </form>
      </section>
    </main>
  )
}

export default PasswordRecoveryScreen
