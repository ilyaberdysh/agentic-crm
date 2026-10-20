-- Auth tables (ARCHITECTURE D-15): Better Auth, email + password, cookie sessions.
-- Generated from our Better Auth config (`pnpm --filter @agentic-crm/api auth:schema` against an empty database),
-- then adjusted: ids default to uuidv7() (Postgres 18) instead of gen_random_uuid(), lower-case email check,
-- unique (provider_id, account_id), comments. Better Auth sets created_at/updated_at itself.
-- `users` is the identity referenced by workspace members (packages/db 0100–0199): users.id is a uuid.
-- Auth tables are global (not tenant tables): a user can belong to several workspaces (I2 applies to members).

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE users IS 'Signed-in identities (Better Auth "user"). Profile fields beyond name/email/image live with workspace members.';

-- One row per signed-in browser/device (Attio "auth session": started_at = created_at, last_seen ~ updated_at).
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
COMMENT ON COLUMN sessions.token IS 'Opaque session token; the agentic-crm-session cookie carries it HMAC-signed.';

-- Credentials per provider; email + password uses provider_id = ''credential'' with the scrypt hash in password.
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX accounts_user_id_idx ON accounts (user_id);

-- Short-lived verification values (email verification / password reset / future email OTP).
CREATE TABLE verifications (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_identifier_idx ON verifications (identifier);
