import { useEffect } from 'react';
import { documentTitle } from './brand';

/** `"<page title> - <brand>"`. */
export function useDocumentTitle(page: string | null | undefined): void {
  useEffect(() => {
    document.title = documentTitle(page);
  }, [page]);
}
