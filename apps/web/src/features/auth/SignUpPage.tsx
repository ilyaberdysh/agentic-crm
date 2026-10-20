// `/welcome/sign-in` — account creation for invited people (K legacy-welcome §6.2 layout; D-15 email + password).
// Sign-up is by invitation: the invite link (`/auth/join/<slug>?invite=<token>`) arrives here as `origin`; after the
// account exists the browser goes back to that link, which accepts the invite.
import { Button, TextInput } from '@agentic-crm/ui';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { afterSignInPath } from '../../app/routeGuards';
import { signUp } from '../../data/session';
import { HttpError, httpStatusOf } from '../../data/trpc';
import { brand } from '../../lib/brand';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { AuthFooter } from './AuthLayout';
import * as a from './auth.css';
import { Wordmark } from './Wordmark';
import * as s from './welcome.css';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

interface Errors {
  name?: string;
  email?: string;
  password?: string;
  form?: string;
}

function signUpErrors(error: unknown): Errors {
  const status = httpStatusOf(error);
  const message = error instanceof HttpError ? error.message : '';
  if (status === 409 || status === 422 || /exist/i.test(message)) {
    return { email: 'An account with this email address already exists.' };
  }
  if (status === 429) return { form: 'Too many sign in attempts' };
  if (status === 400 && /password/i.test(message)) return { password: message };
  if (status === 0) return { form: 'There was an error creating your account. Check your connection and try again.' };
  return { form: message || 'There was an error creating your account.' };
}

/** The invite link this sign-up belongs to, if any (`/auth/join/<slug>?invite=<token>`). */
export function inviteFromOrigin(origin: string | undefined): { slug: string; token: string | null } | null {
  if (!origin?.startsWith('/auth/join/')) return null;
  const url = new URL(origin, 'http://local');
  const slug = decodeURIComponent(url.pathname.slice('/auth/join/'.length).split('/')[0] ?? '');
  return slug ? { slug, token: url.searchParams.get('invite') } : null;
}

export function SignUpPage({ origin }: { origin?: string }) {
  useDocumentTitle('Create your account');
  const invite = inviteFromOrigin(origin);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: Errors = {};
    if (!name.trim()) next.name = 'Please enter your name';
    if (!EMAIL.test(email.trim())) next.email = 'Please enter a valid email';
    if (password.length < MIN_PASSWORD) next.password = `Use at least ${MIN_PASSWORD} characters`;
    setErrors(next);
    if (next.name || next.email || next.password) return;
    setPending(true);
    try {
      await signUp({ name, email, password });
      window.location.assign(afterSignInPath(origin));
    } catch (error) {
      setErrors(signUpErrors(error));
      setPending(false);
    }
  }

  return (
    <main className={a.page}>
      <header className={a.header}>
        <Wordmark />
      </header>
      <div className={s.cardWrap}>
        <div className={s.card}>
          <div className={s.left}>
            {invite ? (
              <form className={s.fields} onSubmit={onSubmit} noValidate>
                <h1 className={s.stepTitle}>Create your account</h1>
                <TextInput
                  label="Full name"
                  name="name"
                  autoComplete="name"
                  icon="user"
                  placeholder="Enter your full name"
                  autoFocus
                  value={name}
                  onChange={setName}
                  isInvalid={Boolean(errors.name)}
                  errorMessage={errors.name}
                />
                <TextInput
                  label="Work email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  icon="emails"
                  placeholder="Enter your work email address"
                  value={email}
                  onChange={setEmail}
                  isInvalid={Boolean(errors.email)}
                  errorMessage={errors.email}
                />
                <TextInput
                  label="Password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  icon="key"
                  placeholder="Choose a password"
                  value={password}
                  onChange={setPassword}
                  isInvalid={Boolean(errors.password)}
                  errorMessage={errors.password}
                />
                <Button type="submit" variant="primary" size={32} fullWidth isPending={pending}>
                  {pending ? 'Creating account...' : 'Continue'}
                </Button>
                {errors.form && (
                  <div role="alert" className={a.formError}>
                    {errors.form}
                  </div>
                )}
                <p className={a.helper}>
                  Already have an account?{' '}
                  <Link to="/auth/sign-in" search={{ origin }}>
                    Sign in
                  </Link>
                </p>
              </form>
            ) : (
              <div className={s.notice}>
                <h1 className={s.stepTitle}>Sign-up is by invitation</h1>
                <p className={s.paragraph}>
                  Ask a workspace admin to invite you, then open the invite link from your email to create your account.
                </p>
                <p className={a.helper} style={{ textAlign: 'left', marginTop: 0 }}>
                  Already have an account? <Link to="/auth/sign-in">Sign in</Link>
                </p>
              </div>
            )}
          </div>
          <div className={s.right}>
            <h2 className={s.heading}>Welcome to {brand.name}.</h2>
            <p className={s.paragraph}>
              {invite
                ? `You've been invited to join the ${invite.slug} workspace. Create your account to get started.`
                : 'The CRM for your team: every company, person and deal in one place, always up to date.'}
              {'\n\n'}From here, you'll always know your next move.{'\n\n'}Let's begin.
            </p>
          </div>
        </div>
      </div>
      <AuthFooter />
    </main>
  );
}
