// "Create email template" switches the composer window to the template editor (F composer §2.12): the draft stays
// behind it, ‹ goes back, "Use template" starts a new draft from the template.
import * as s from './composer.css';
import { TemplateEditor } from './TemplateEditor';

export function TemplateView({
  mode,
  templateId,
  onBack,
  onClose,
}: {
  id: string;
  mode: 'modal' | 'floating';
  templateId: string;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div className={s.root} data-mode={mode} data-view="template" data-testid="composer-template">
      <TemplateEditor templateId={templateId} variant="composer" onBack={onBack} onClose={onClose} />
    </div>
  );
}
