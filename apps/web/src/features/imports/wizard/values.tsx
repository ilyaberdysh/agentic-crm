// Write-form values of the import (resolutions, overrides, plan rows) drawn with the real attribute Views, and edited
// with the real Editors (review values "fix value" / "Add value").
import type { AttributeDefinition, AttributeValue } from '@agentic-crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { newId } from '../../../lib/ids';
import { getAttributeUi, membersQuery, optionsQuery, stagesQuery } from '../../attributes';
import type { CommitInput } from '../../attributes/types';
import { toWriteForm } from '../../attributes/values/shapes';
import { planCommit } from '../../attributes/write/plan';
import { overlayRows } from '../../attributes/write/useAttributeWrite';
import { useImportsWorkspace } from '../data/backend';

const PREVIEW_RECORD = '00000000-0000-7000-8000-000000000000';

export function previewRef(attribute: AttributeDefinition) {
  return { entityDefinitionId: attribute.entityDefinitionId, entityInstanceId: PREVIEW_RECORD };
}

/** Write forms → read rows a View can draw. */
export function toRows(attribute: AttributeDefinition, values: readonly unknown[]): AttributeValue[] {
  return values.map((value, i) => {
    const row = overlayRows(value, attribute, previewRef(attribute))[0] as AttributeValue;
    return {
      ...row,
      id: `import:${attribute.id}:${i}`,
      sortOrder: attribute.isMultiselect ? String.fromCharCode(97 + (i % 26)) : null,
    };
  });
}

/** An editor commit applied to the shown values → the new write-form values. */
export function applyCommit(attribute: AttributeDefinition, values: readonly unknown[], next: CommitInput): unknown[] {
  const plan = planCommit(attribute, toRows(attribute, values), next, {
    recordRef: { ...previewRef(attribute), workspace: { id: attribute.workspaceId } },
    newId,
  });
  return plan.optimistic.filter((r) => r.activeUntil === null).map((r) => toWriteForm(attribute.type, r.value));
}

export function ValueView({
  attribute,
  values,
  density = 'cell',
  field,
}: {
  attribute: AttributeDefinition;
  values: readonly unknown[];
  density?: 'cell' | 'field' | 'chip';
  field?: string | null;
}) {
  const { View } = getAttributeUi(attribute.type);
  // Views read option / stage / member titles from the query cache: load them for this attribute.
  const ws = useImportsWorkspace();
  useQuery({ ...optionsQuery(ws, attribute), enabled: attribute.type === 'select' });
  useQuery({ ...stagesQuery(ws, attribute), enabled: attribute.type === 'pipeline' });
  useQuery({ ...membersQuery(ws), enabled: attribute.type === 'actor-reference' });
  return (
    <View
      attribute={attribute}
      values={toRows(attribute, values)}
      density={density}
      field={field ?? undefined}
      recordRef={previewRef(attribute)}
    />
  );
}
