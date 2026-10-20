// `/auth/sign-in` (legacy-welcome) adapted to email + password: no Google or
// SAML buttons; the fields follow the temporary-password step (email + secret + Continue, 12 px apart).
import { Button, TextInput } from '@agentic-crm/ui';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { afterSignInPath } from '../../app/routeGuards';
import { signIn } from '../../data/session';
import { HttpError, httpStatusOf } from '../../data/trpc';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { AuthLayout } from './AuthLayout';
import * as s from './auth.css';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  email?: string;
  password?: string;
  form?: string;
}

export function signInErrorMessage(error: unknown): FieldErrors {
  const status = httpStatusOf(error);
  if (status === 401 || status === 400) return { password: 'Email or password not entered correctly' };
  if (status === 403) return { form: 'Your account has been locked, contact support for more information' };
  if (status === 429) return { form: 'Too many sign in attempts' };
  if (status === 0) return { form: 'There was an error signing in. Check your connection and try again.' };
  return { form: error instanceof HttpError ? error.message : 'There was an error signing in.' };
}

export function SignInPage({ origin }: { origin?: string }) {
  useDocumentTitle('Sign in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const inviteOrigin = origin?.startsWith('/auth/join/') ? origin : undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: FieldErrors = {};
    if (!EMAIL.test(email.trim())) next.email = 'Please enter a valid email';
    if (!password) next.password = 'Please enter your password';
    setErrors(next);
    if (next.email || next.password) return;
    setPending(true);
    try {
      await signIn({ email, password });
      // Full page load, by design after the code step: the UI boots with the new session.
      window.location.assign(afterSignInPath(origin));
    } catch (error) {
      setErrors(signInErrorMessage(error));
      setPending(false);
    }
  }

  return (
    <AuthLayout legal contentClassName={s.signInBlock}>
      <h1 className={s.title}>Sign in</h1>
      <form className={s.form} onSubmit={onSubmit} noValidate>
        <TextInput
          aria-label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          icon="emails"
          placeholder="Enter your work email address"
          autoFocus
          value={email}
          onChange={(v) => {
            setEmail(v);
            if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
          }}
          isInvalid={Boolean(errors.email)}
          errorMessage={errors.email}
        />
        <TextInput
          aria-label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          icon="key"
          placeholder="Enter your password"
          value={password}
          onChange={(v) => {
            setPassword(v);
            if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
          }}
          isInvalid={Boolean(errors.password)}
          errorMessage={errors.password}
        />
        <Button type="submit" variant="primary" size={32} fullWidth isPending={pending}>
          {pending ? 'Signing in...' : 'Continue'}
        </Button>
        {errors.form && (
          <div role="alert" className={s.formError}>
            {errors.form}
          </div>
        )}
      </form>
      {inviteOrigin && (
        <p className={s.helper}>
          No account?{' '}
          <Link to="/welcome/sign-in" search={{ origin: inviteOrigin }}>
            Create one
          </Link>
        </p>
      )}
    </AuthLayout>
  );
}
