// Product identity and public project links. Policy URLs can be supplied by a deployment when it has adopted them.
export const brand = {
  /** Shown in document titles ("Home - <name>") and the wordmark. */
  name: 'Agentic CRM',
  /** Lower-case wordmark text next to the logo mark. */
  wordmark: 'agentic crm',
  supportUrl: 'https://github.com/ilyaberdysh/agentic-crm/issues',
  // Set these only when the deployment has adopted corresponding policies.
  privacyUrl: import.meta.env.VITE_PRIVACY_URL?.trim() || '',
  termsUrl: import.meta.env.VITE_TERMS_URL?.trim() || '',
  acceptableUseUrl: import.meta.env.VITE_ACCEPTABLE_USE_URL?.trim() || '',
} as const;

export function documentTitle(page?: string | null): string {
  return page ? `${page} - ${brand.name}` : brand.name;
}
