// The schema read model a report needs (labels, attribute types, formats): the data source plus every definition its
// paths pass through.
import type { ReportSettings } from '@agentic-crm/contracts';
import { useMemo } from 'react';
import { useSchemaIndex } from '../views/data';
import { definitionsOfPaths } from '../views/schemaIndex';
import { settingsPaths } from './reportModel';

export function useReportSchema(entityDefinitionId: string | null | undefined, settings: ReportSettings | null) {
  const defs = useMemo(() => definitionsOfPaths(settings ? settingsPaths(settings) : []), [settings]);
  return useSchemaIndex(entityDefinitionId, defs);
}
