// Product identity. Attio's name, wordmark and legal entity are not reused (clean room, PLAN §1); the layout of the
// places that show them (auth pages, footers, document titles) follows Attio.
export const brand = {
  /** Shown in document titles ("Home - <name>") and the wordmark. */
  name: 'Agentic CRM',
  /** Lower-case wordmark text next to the logo mark. */
  wordmark: 'agentic crm',
  legalEntity: 'mymeet.ai',
  privacyUrl: 'https://mymeet.ai/privacy',
  supportUrl: 'https://mymeet.ai/support',
  termsUrl: 'https://mymeet.ai/terms',
  acceptableUseUrl: 'https://mymeet.ai/terms',
} as const;

export function documentTitle(page?: string | null): string {
  return page ? `${page} - ${brand.name}` : brand.name;
}
