import { useEffect } from 'react';
import { documentTitle } from './brand';

/** `"<page title> - <brand>"` (B README §2.1). */
export function useDocumentTitle(page: string | null | undefined): void {
  useEffect(() => {
    document.title = documentTitle(page);
  }, [page]);
}
