// Step 1 — Upload file (C2 import.md §I2; evidence import-1-upload-empty / -file): a dashed drop zone with
// "Drop your .CSV file onto this area to upload", "or", "Choose a .CSV file"; the file is parsed in the browser and
// shown as a card (name, ".CSV file - {size}", Columns found / Rows found). "Next" creates the draft with the
// client-side auto-mapping and starts the background upload.
import { AlertDialog, Button, Icon, IconButton, toast } from '@agentic-crm/ui';
import { type DragEvent, useRef, useState } from 'react';
import { newId } from '../../../lib/ids';
import { CsvError, exampleValues, formatFileSize, type ParsedCsv, parseCsvFile } from '../csv/parse';
import { createImport, removeImport, useImportsWorkspace } from '../data/backend';
import { cancelUpload, startUpload } from '../data/upload';
import { autoMap } from '../model/mapping';
import { UploadIllustration } from './Illustration';
import type { WizardContext } from './ImportWizard';
import { useImportSchema } from './schema';
import * as s from './wizard.css';

/** Help articles (our help center does not exist yet: the cards only say so). */
const LEARN_MORE = ['Importing', 'Import data via CSV'];

export function UploadStep({ ctx }: { ctx: WizardContext }) {
  const ws = useImportsWorkspace();
  const index = useImportSchema(ctx.destination.definition.id);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<ParsedCsv | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startOver, setStartOver] = useState(false);
  const job = ctx.job;

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    setValidating(true);
    try {
      setFile(await parseCsvFile(picked));
    } catch (e) {
      setFile(null);
      setError(e instanceof CsvError ? e.message : 'There was an error parsing this file');
    } finally {
      setValidating(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void choose(e.dataTransfer.files[0]);
  };

  const next = async () => {
    if (job) return ctx.go({ step: 'map-properties', param: null });
    if (!file || !index || busy) return;
    setBusy(true);
    try {
      const columns = file.headers.map((title, i) => ({ index: i, title, exampleValues: exampleValues(file.rows, i) }));
      const importId = newId();
      const jobId = newId();
      await createImport(ws, {
        importId,
        jobId,
        entityDefinitionId: ctx.destination.definition.id,
        fileName: file.fileName,
        fileSize: file.fileSize,
        sourceType: 'csv',
        columns,
        rowCount: file.rows.length,
        mapping: autoMap(columns, index, ctx.destination.definition.id, newId),
      });
      startUpload(ws, jobId, file.rows);
      ctx.go({ step: 'map-properties', importId, jobId, param: null });
    } catch {
      toast.error('Failed to upload file');
      setBusy(false);
    }
  };

  const shown = job
    ? { name: job.fileName, size: job.fileSize, columns: job.columnCount, rows: job.rowCount }
    : file
      ? { name: file.fileName, size: file.fileSize, columns: file.headers.length, rows: file.rows.length }
      : null;

  return (
    <>
      <div className={s.uploadBody}>
        <div
          className={s.dropZone}
          data-dragging={dragging || undefined}
          data-testid="import-drop-zone"
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragging(false);
          }}
          onDrop={onDrop}
        >
          {shown ? (
            <div className={s.fileCard} data-testid="import-file-card">
              <div className={s.fileHead}>
                <div className={s.fileText}>
                  <div className={s.fileName}>{shown.name}</div>
                  <div className={s.fileMeta}>.CSV file - {formatFileSize(shown.size)}</div>
                </div>
                <IconButton
                  icon="delete"
                  aria-label="Remove file"
                  onPress={() => (job ? setStartOver(true) : (setFile(null), setError(null)))}
                />
              </div>
              <div className={s.fileRule} />
              <div className={s.stats}>
                <div className={s.stat}>
                  <div className={s.statLabel}>
                    <Icon icon="columnsFound" size={14} />
                    Columns found
                  </div>
                  <div className={s.statValue} data-testid="columns-found">
                    {shown.columns.toLocaleString('en-US')}
                  </div>
                </div>
                <div className={s.stat}>
                  <div className={s.statLabel}>
                    <Icon icon="rowsFound" size={14} />
                    Rows found
                  </div>
                  <div className={s.statValue} data-testid="rows-found">
                    {shown.rows.toLocaleString('en-US')}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <UploadIllustration />
              <div className={s.dropText}>
                {dragging
                  ? 'Drop a .CSV file here to upload'
                  : validating
                    ? 'Validating file…'
                    : 'Drop your .CSV file onto this area to upload'}
              </div>
              <div className={s.orDivider}>or</div>
              <Button variant="secondary" size={32} className={s.chooseButton} onPress={() => input.current?.click()}>
                Choose a .CSV file
              </Button>
              {error && (
                <div className={s.uploadError} role="alert">
                  {error}
                </div>
              )}
              <input
                ref={input}
                type="file"
                accept="text/csv,.csv"
                hidden
                data-testid="import-file-input"
                onChange={(e) => {
                  void choose(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>
        <div className={s.learnMore}>
          <div className={s.learnLabel}>Learn more</div>
          <div className={s.learnCards}>
            {LEARN_MORE.map((title) => (
              <button
                key={title}
                type="button"
                className={s.learnCard}
                onClick={() => toast({ title, description: 'Help articles arrive with the help center.' })}
              >
                <span className={s.learnTile}>
                  <Icon icon="learn" size={24} />
                </span>
                {title}
              </button>
            ))}
          </div>
        </div>
      </div>
      <footer className={s.footer}>
        <Button size={28} isDisabled={!shown || (!job && !index)} isPending={busy} onPress={() => void next()}>
          Next
        </Button>
      </footer>
      {job && (
        <StartOverDialog
          isOpen={startOver}
          onOpenChange={setStartOver}
          onConfirm={() => {
            cancelUpload(job.jobId);
            void removeImport(ws, job.jobId).catch(() => undefined);
            ctx.go({ step: 'upload', importId: null, jobId: null }, true);
          }}
        />
      )}
    </>
  );
}

export function StartOverDialog({
  isOpen,
  onOpenChange,
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Are you sure you want to start a new import?"
      description="This will cancel the background file upload, and any progress you have made will be lost."
      confirmLabel="Start over"
      onConfirm={onConfirm}
    />
  );
}
