// Generic error placeholder (system-ui): centred red "Something went wrong" with a retry that re-runs the
// route's loaders (data errors retry by invalidating, like the error boundaries).
import { Button, ErrorState } from '@agentic-crm/ui';
import { type ErrorComponentProps, useRouter } from '@tanstack/react-router';
import * as s from '../features/shell/shell.css';

export function ErrorPage({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className={s.bootCenter}>
      <ErrorState
        actions={
          <Button
            variant="secondary"
            size={28}
            onPress={() => {
              reset();
              void router.invalidate();
            }}
          >
            Try again
          </Button>
        }
      />
    </div>
  );
}
