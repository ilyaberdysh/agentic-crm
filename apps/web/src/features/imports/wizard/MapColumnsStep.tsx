// Step 2 — Map columns (C2 import.md §I3, §I9; evidence import-2-map-columns / -attribute-picker): "File column → Attributes"
// rows with a mapping chip (type icon, attribute title, × "Remove attribute mapping") or "Select attribute", the data
// preview of the focused column on the right, list imports' "For records already in the list:" strategy pill, and
// validation + the duplicate warning on Continue.
import type { EntityDefinition } from '@agentic-crm/contracts';
import { AlertDialog, Button, Icon, Menu, MenuItem, MenuTrigger, Popover, toast } from '@agentic-crm/ui';
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { keys } from '../../../data/keys';
import { useObjects } from '../../../data/objects';
import { queryClient } from '../../../data/queryClient';
import { newId } from '../../../lib/ids';
import { AttributeDialog } from '../../settings/objects/attributes/AttributeDialog';
import type { PickerType } from '../../settings/objects/attributes/typeCatalog';
import { attributeIcon } from '../../views/operators';
import { removeImport, setMapping, useImportsWorkspace } from '../data/backend';
import type { ImportColumn, ImportJob, ListStrategy, MappingProperty } from '../data/contract';
import { cancelUpload, uploadPercent, useUpload } from '../data/upload';
import {
  hasUniqueMapping,
  hopOf,
  mappingLabel,
  newProperty,
  uniqueAttributesFor,
  validateMapping,
} from '../model/mapping';
import { AttributePicker, type PickedTarget } from './AttributePicker';
import type { WizardContext } from './ImportWizard';
import { useImportSchema } from './schema';
import { StartOverDialog } from './UploadStep';
import * as s from './wizard.css';

export function MapColumnsStep({ ctx, job }: { ctx: WizardContext; job: ImportJob }) {
  const ws = useImportsWorkspace();
  const index = useImportSchema(job.entityDefinitionId);
  const upload = useUpload(job.jobId);
  const [focused, setFocused] = useState(0);
  const [openColumn, setOpenColumn] = useState<number | null>(null);
  const [creating, setCreating] = useState<{ column: ImportColumn; type: PickerType } | null>(null);
  const [duplicates, setDuplicates] = useState(false);
  const [startOver, setStartOver] = useState(false);
  const objects = useObjects(ws).data ?? [];

  const validation = validateMapping(job, index);
  const byColumn = new Map(job.mapping.map((p) => [p.columnIndex, p]));
  const column = job.columns[focused];

  const save = async (columnIndex: number, property: MappingProperty | null) => {
    try {
      await setMapping(ws, { jobId: job.jobId, columns: [{ columnIndex, property }] });
    } catch {
      toast.error('Failed to update the mapping');
    }
  };

  const pick = (col: ImportColumn, target: PickedTarget) => {
    setOpenColumn(null);
    const existing = byColumn.get(col.index);
    void save(col.index, newProperty(existing?.id ?? newId(), col, target.path, target.attribute, target.field));
  };

  const proceed = () => {
    const first = [...job.mapping].sort((a, b) => a.columnIndex - b.columnIndex)[0];
    ctx.go({ step: 'review-values', param: first?.id ?? null });
  };

  const onContinue = () => {
    if (validation.error || !index) return;
    if (!hasUniqueMapping(job, index)) setDuplicates(true);
    else proceed();
  };

  const uniques = index ? uniqueAttributesFor(index, job.entityDefinitionId) : [];
  const uploading = upload?.state === 'uploading' || (!upload && job.status === 'ingesting');

  return (
    <>
      <div className={s.mapBody}>
        <div className={s.mapLeft}>
          <div className={s.mapHeaderRow}>
            <span>File column</span>
            <span>Attributes</span>
          </div>
          <div className={s.mapScroll} data-testid="map-columns">
            {job.columns.map((col) => {
              const property = byColumn.get(col.index);
              const leaf = property ? index?.attribute(property.path[property.path.length - 1] as never) : undefined;
              const error = validation.columnErrors.get(col.index);
              return (
                <div
                  key={col.index}
                  className={s.mapRow}
                  data-focused={focused === col.index || undefined}
                  data-invalid={error ? true : undefined}
                  data-testid="map-row"
                  onMouseEnter={() => setFocused(col.index)}
                  onClick={() => setFocused(col.index)}
                  onKeyDown={() => {}}
                  title={error}
                >
                  <div className={s.mapColumnCell}>
                    <span className={s.mapColumnName}>{col.title}</span>
                    <span className={s.mapArrow}>
                      <Icon icon="arrowRight" size={16} />
                    </span>
                  </div>
                  <div
                    className={s.mapChip}
                    data-empty={property ? undefined : true}
                    data-open={openColumn === col.index || undefined}
                  >
                    <Popover
                      isOpen={openColumn === col.index}
                      onOpenChange={(open) => setOpenColumn(open ? col.index : null)}
                      placement="bottom start"
                      offset={6}
                      aria-label="Select attribute"
                      trigger={
                        <AriaButton
                          className={s.chipButton}
                          aria-label={property ? `Change mapping of ${col.title}` : `Select attribute for ${col.title}`}
                          onPress={() => setFocused(col.index)}
                        >
                          {property && leaf ? (
                            <>
                              <Icon icon={attributeIcon(leaf)} size={16} className={s.chipIcon} />
                              <span className={s.chipLabel}>{mappingLabel(index, property.path, property.field)}</span>
                            </>
                          ) : property ? (
                            <span className={s.chipLabel}>{mappingLabel(index, property.path, property.field)}</span>
                          ) : (
                            <span className={s.chipLabel}>Select attribute</span>
                          )}
                        </AriaButton>
                      }
                    >
                      {index && (
                        <AttributePicker
                          index={index}
                          destinationId={job.entityDefinitionId}
                          onSelect={(target) => pick(col, target)}
                          onCreate={(type) => {
                            setOpenColumn(null);
                            setCreating({ column: col, type });
                          }}
                        />
                      )}
                    </Popover>
                    {property ? (
                      <button
                        type="button"
                        className={s.chipClear}
                        aria-label="Remove attribute mapping"
                        onClick={() => void save(col.index, null)}
                      >
                        <Icon icon="close" size={14} />
                      </button>
                    ) : (
                      <Icon icon="chevronDown" size={14} className={s.chipIcon} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {ctx.destination.isList && <ListStrategyPill job={job} />}
        </div>
        <aside className={s.mapRight}>{column && <DataPreview column={column} />}</aside>
      </div>
      <footer className={s.footer}>
        {validation.error ? (
          <span className={s.footerMessage} data-testid="map-error">
            {validation.error}
          </span>
        ) : uploading ? (
          <span className={s.footerNote}>Uploading file… {uploadPercent(upload)}%</span>
        ) : upload?.state === 'failed' ? (
          <span className={s.footerMessage}>Failed to upload file</span>
        ) : (
          <span className={s.footerNote} />
        )}
        <Button variant="secondary" size={28} onPress={() => setStartOver(true)}>
          Start over
        </Button>
        <Button size={28} isDisabled={Boolean(validation.error) || !index} onPress={onContinue}>
          Continue
        </Button>
      </footer>
      <StartOverDialog
        isOpen={startOver}
        onOpenChange={setStartOver}
        onConfirm={() => {
          cancelUpload(job.jobId);
          void removeImport(ws, job.jobId).catch(() => undefined);
          ctx.go({ step: 'upload', importId: null, jobId: null }, true);
        }}
      />
      <AlertDialog
        isOpen={duplicates}
        onOpenChange={setDuplicates}
        variant="primary"
        title="Import may add duplicate records"
        description="This import will create new records as no unique identifier is mapped, so existing records can't be matched. To prevent duplicates, map one of the following attributes:"
        confirmLabel="Continue with duplicates"
        cancelLabel="Go back"
        onConfirm={proceed}
      >
        {uniques.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            {uniques.map((a) => (
              <li key={a.id}>{a.title}</li>
            ))}
          </ul>
        )}
      </AlertDialog>
      {creating && (
        <AttributeDialog
          workspace={ws}
          object={ctx.destination.definition}
          objects={objects as unknown as EntityDefinition[]}
          mode={{ kind: 'create' }}
          initialType={creating.type}
          initialTitle={creating.column.title}
          isOpen
          onOpenChange={(open) => !open && setCreating(null)}
          onCreated={(attribute) => {
            void queryClient.invalidateQueries({ queryKey: keys.attributes(ws.id, attribute.entityDefinitionId) });
            const col = creating.column;
            const existing = byColumn.get(col.index);
            void save(col.index, newProperty(existing?.id ?? newId(), col, [hopOf(attribute)], attribute, null));
          }}
        />
      )}
    </>
  );
}

function DataPreview({ column }: { column: ImportColumn }) {
  const values = column.exampleValues;
  const hasValues = values.some((v) => v.trim());
  return (
    <>
      <div className={s.previewCard} data-testid="data-preview">
        <div className={s.previewHead}>
          <span>{column.title}</span>
          <span className={s.previewBadge}>
            <Icon icon="show" size={14} />
            Data preview
          </span>
        </div>
        {hasValues ? (
          values.map((v) => (
            <div key={v} className={s.previewValue} data-empty={v ? undefined : true}>
              {v || 'Empty'}
            </div>
          ))
        ) : (
          <div className={s.previewValue} data-empty>
            This column has no values
          </div>
        )}
      </div>
      {hasValues && <div className={s.previewNote}>This preview shows only a portion of the column values</div>}
    </>
  );
}

const STRATEGIES: Array<{ id: ListStrategy; label: string; description: string }> = [
  { id: 'create', label: 'Add again', description: 'Add new list entries in addition to existing ones' },
  { id: 'create-or-update', label: 'Update existing', description: 'Update existing list entries' },
];

function ListStrategyPill({ job }: { job: ImportJob }) {
  const ws = useImportsWorkspace();
  const current = STRATEGIES.find((x) => x.id === job.listStrategy) ?? (STRATEGIES[0] as (typeof STRATEGIES)[number]);
  return (
    <div className={s.strategyPill} data-testid="list-strategy">
      For records already in the list:
      <MenuTrigger>
        <Button variant="secondary" size={28} chevron>
          {current.label}
        </Button>
        <Menu
          aria-label="For records already in the list"
          selectionMode="single"
          selectedKeys={[job.listStrategy]}
          placement="top"
          width={300}
          onAction={(k) =>
            void setMapping(ws, { jobId: job.jobId, listStrategy: k as ListStrategy }).catch(() =>
              toast.error('Failed to update the import'),
            )
          }
        >
          {STRATEGIES.map((x) => (
            <MenuItem key={x.id} id={x.id} description={x.description}>
              {x.label}
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
    </div>
  );
}
