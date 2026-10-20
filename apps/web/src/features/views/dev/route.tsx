// `/<workspace>/__dev/views` (dev builds): see ViewsDevPage.
import { type AnyRoute, createRoute } from '@tanstack/react-router';
import { ViewsDevPage, type ViewsDevSearch } from './ViewsDevPage';

export function createViewsDevRoute<P extends AnyRoute>(getParentRoute: () => P) {
  const route = createRoute({
    getParentRoute,
    path: '__dev/views',
    validateSearch: (search: Record<string, unknown>): ViewsDevSearch => ({
      object: typeof search.object === 'string' ? search.object : undefined,
      view: typeof search.view === 'string' ? search.view : undefined,
      extras: search.extras === true || search.extras === 1 || search.extras === '1' ? true : undefined,
      empty:
        search.empty === true || search.empty === 1 || search.empty === '1' || search.empty === 'true'
          ? true
          : undefined,
    }),
    component: function ViewsDevRoute() {
      const search = route.useSearch() as ViewsDevSearch;
      const navigate = route.useNavigate();
      return (
        <ViewsDevPage search={search} navigate={(next) => void navigate({ search: next as never, replace: false })} />
      );
    },
  });
  return route;
}
