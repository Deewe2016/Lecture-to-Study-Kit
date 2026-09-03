import { FormEvent, useState } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import { signIn, signUp, type AuthUser } from '@/lib/auth';

export default function AuthPage({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (mode === 'signup' && !name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        const user = await signUp(name.trim(), email.trim(), password);
        if (user) onAuthenticated(user);
        else setMessage('Account created. Check your email to confirm your account, then log in.');
      } else {
        onAuthenticated(await signIn(email.trim(), password));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return <main className="flex min-h-[100dvh] items-center justify-center bg-background px-5 py-10 text-foreground">
    <div className="w-full max-w-md">
      <div className="mb-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          {mode === 'login' ? <LogIn size={22} /> : <UserPlus size={22} />}
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{mode === 'login' ? 'Log in to your Flexus workspace.' : 'Set up your Flexus workspace in a minute.'}</p>
      </div>

      <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8">
        {mode === 'signup' && <label className="block text-sm font-medium">Name<input value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Your name" className="focus-ring mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none" /></label>}
        <label className={`block text-sm font-medium ${mode === 'signup' ? 'mt-4' : ''}`}>Email<input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@example.com" required className="focus-ring mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none" /></label>
        <label className="mt-4 block text-sm font-medium">Password<input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" minLength={8} required className="focus-ring mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none" /></label>

        {error && <p role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2.5 text-xs text-red-200">{error}</p>}
        {message && <p role="status" className="mt-4 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 text-xs text-primary">{message}</p>}

        <button disabled={busy} className="mt-6 flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage(''); }} className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground">
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Log in'}
        </button>
      </form>
      <p className="mt-5 text-center text-[11px] text-muted-foreground">Your password is handled by the authentication provider and is never stored by Flexus.</p>
    </div>
  </main>;
}
