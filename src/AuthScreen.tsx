import { useState, type FormEvent } from 'react'

type AuthScreenProps = {
  configured: boolean
  loading: boolean
  error: string
  notice: string
  onSignIn: (email: string, password: string) => Promise<void>
  onForgotPassword: (email: string) => Promise<void>
}

function AuthScreen({ configured, loading, error, notice, onSignIn, onForgotPassword }: AuthScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void onSignIn(email.trim(), password)
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
          <h1 className="cond">SIGN IN</h1>
          <span>Welcome back</span>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label className="form-label">
            Email
            <input
              autoComplete="username"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              disabled={!configured || loading}
            />
          </label>
          <label className="form-label">
            Password
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              required
              disabled={!configured || loading}
            />
          </label>
          {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
          {notice && <p className="form-notice" role="status">{notice}</p>}
          <button className="auth-submit cond" type="submit" disabled={!configured || loading}>
            {loading ? 'PLEASE WAIT…' : 'SIGN IN'}
          </button>
          <button
            className="auth-link"
            type="button"
            disabled={!configured || loading || !email.trim()}
            onClick={() => void onForgotPassword(email.trim())}
          >
            Forgot password?
          </button>
        </form>
      </section>
    </main>
  )
}

export default AuthScreen
