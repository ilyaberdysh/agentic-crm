// Gmail + Google Calendar connector (slice 7b, BACKLOG 7.09). See connector.ts for the sync model, oauth.ts for the
// connect flow, tokens.ts for credentials at rest, fake.ts for the test double of the Google APIs.
export { CalendarApi, eventKey, toCalendarChanges, toConnectorEvent } from './calendar.ts';
export { GoogleConnector } from './connector.ts';
export { isSealedValue, resolveEncryptionKey, SealError, type SealedValue, SecretBox } from './crypto.ts';
export { FakeGoogle, type FakeGoogleOptions } from './fake.ts';
export { GmailApi, sendAsAliases } from './gmail.ts';
export { GoogleApiError, GoogleNetworkError, googleRequest, toConnectorError } from './http.ts';
export {
  createGoogleIntegration,
  GoogleConnectError,
  type GoogleConnectFailure,
  type GoogleIntegration,
} from './integration.ts';
export {
  buildMime,
  decodeEncodedWords,
  htmlToText,
  parseAddressList,
  parseMessageIds,
  toConnectorMessage,
} from './mime.ts';
export { OAUTH_TTL_SECONDS, type OAuthState, type VerifiedAuthorization } from './oauth.ts';
export {
  GOOGLE_ENDPOINTS,
  GOOGLE_SCOPES,
  type GoogleSettings,
  googleSettingsFromEnv,
  REQUIRED_SCOPES,
  resolveGoogleSettings,
} from './settings.ts';
export { type CredentialStore, type GoogleCredentials, GoogleTokens, RECONNECT_MESSAGES } from './tokens.ts';
