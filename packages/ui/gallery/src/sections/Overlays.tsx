import { useState } from 'react';
import {
  AlertDialog,
  Avatar,
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FilterableMenu,
  HoverCard,
  IconButton,
  IconTile,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  Modal,
  Popover,
  Submenu,
  Switch,
  Text,
  TextInput,
  ToastCard,
  Tooltip,
  toast,
} from '../../../src';
import { CreateRecordContent } from '../CreateRecord';
import { Col, Panels, Row, Section } from '../kit';

function ImportExportMenu() {
  return (
    <MenuTrigger>
      <Button variant="secondary" size={28} icon="importExport" chevron>
        Import / Export
      </Button>
      <Menu placement="bottom end" aria-label="Import / Export">
        <MenuItem icon="migrate">Migrate CRM</MenuItem>
        <MenuSeparator />
        <MenuItem icon="importCsv">Import CSV</MenuItem>
        <MenuSeparator />
        <MenuItem icon="exportCsv">Export view as CSV</MenuItem>
        <MenuItem icon="exportSpreadsheet">Export view as Excel</MenuItem>
        <MenuSeparator />
        <MenuItem icon="help" variant="help">
          Learn about imports and exports
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

function SortMenu() {
  const [sort, setSort] = useState<Set<string>>(new Set(['custom']));
  return (
    <MenuTrigger>
      <IconButton icon="settings" aria-label="Sort records" size={20} />
      <Menu
        aria-label="Sort"
        selectionMode="single"
        selectedKeys={sort}
        onSelectionChange={(keys) => setSort(new Set([...keys].map(String)))}
      >
        <MenuSection title="Sort">
          <MenuItem id="recent">Recently created</MenuItem>
          <MenuItem id="alpha">Alphabetical</MenuItem>
          <MenuItem id="custom">Custom</MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}

function ColumnMenu() {
  return (
    <MenuTrigger>
      <Button variant="secondary" size={28} chevron>
        Column menu
      </Button>
      <Menu aria-label="Column">
        <MenuSection title="Sort">
          <MenuItem icon="arrowUp" shortcut={['shift', 'up']}>
            Sort ascending
          </MenuItem>
          <MenuItem icon="arrowDown" shortcut={['shift', 'down']}>
            Sort descending
          </MenuItem>
        </MenuSection>
        <MenuSeparator />
        <Submenu label="Move" icon="arrowRight">
          <MenuItem icon="arrowLeft">Move left</MenuItem>
          <MenuItem icon="arrowRight">Move right</MenuItem>
        </Submenu>
        <MenuItem icon="edit" description="Only for this view">
          Edit column label
        </MenuItem>
        <MenuItem icon="copy" shortcut={['mod', 'c']}>
          Copy column ID
        </MenuItem>
        <MenuItem icon="hide" isDisabled>
          Hide from view
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="delete" variant="danger">
          Delete attribute
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

function ViewsMenu() {
  return (
    <MenuTrigger>
      <Button variant="secondary" size={28} icon={<IconTile icon="apps" color="green" />} chevron>
        All Companies
      </Button>
      <FilterableMenu aria-label="Views" width={280} selectionMode="single" defaultSelectedKeys={['all']}>
        <MenuSection title="Views">
          <MenuItem id="all" icon="table">
            All Companies
          </MenuItem>
          <MenuItem id="hot" icon="table">
            Hot leads
          </MenuItem>
          <MenuItem id="pipeline" icon="kanban">
            Pipeline
          </MenuItem>
        </MenuSection>
      </FilterableMenu>
    </MenuTrigger>
  );
}

function ContextMenu() {
  return (
    <MenuTrigger>
      <Button variant="ghost" size={28}>
        Context menu
      </Button>
      <Menu aria-label="Context" variant="contextual">
        <MenuItem icon="copy">Copy</MenuItem>
        <MenuItem icon="link">Copy link</MenuItem>
        <MenuSeparator />
        <MenuItem icon="delete">Delete</MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

export function Overlays() {
  const [modal, setModal] = useState<null | 'large' | 'small' | 'overlay'>(null);
  return (
    <>
      <Section
        id="menus"
        title="Menu"
        note="Dropdown semantics (↑/↓, typeahead, → submenu, Esc). Elevated surface, e2, radius 12, items 32 px."
      >
        <Panels>
          {() => (
            <Row>
              <ImportExportMenu />
              <ColumnMenu />
              <ViewsMenu />
              <SortMenu />
              <ContextMenu />
            </Row>
          )}
        </Panels>
      </Section>
      <Section id="popovers" title="Popover, Tooltip, HoverCard">
        <Panels>
          {() => (
            <>
              <Row>
                <Popover
                  trigger={
                    <Button variant="secondary" size={28} icon="viewSettings" chevron>
                      View settings
                    </Button>
                  }
                  width={270}
                  padding={12}
                  aria-label="View settings"
                >
                  <Col>
                    <Text variant="heading.extraSmall">View settings</Text>
                    <TextInput size={28} label="View name" defaultValue="All Companies" />
                    <Switch defaultSelected>Show record count</Switch>
                  </Col>
                </Popover>
                <Tooltip content="Manage record access">
                  <Button variant="ghost" size={28}>
                    Hover for tooltip
                  </Button>
                </Tooltip>
                <Tooltip content="Collapse sidebar" shortcut={['mod', '.']}>
                  <IconButton icon="sidebar" aria-label="Collapse sidebar" />
                </Tooltip>
                <HoverCard
                  content={
                    <Row>
                      <Avatar name="Ilya Ivanov" size={32} />
                      <Col>
                        <Text variant="body.strong" color="primary">
                          Ilya Ivanov
                        </Text>
                        <Text variant="text12.standard">ilya@mymeet.ai</Text>
                      </Col>
                    </Row>
                  }
                  width={280}
                >
                  <button type="button" style={{ all: 'unset', cursor: 'default' }}>
                    <Text variant="body.link">Hover card</Text>
                  </button>
                </HoverCard>
              </Row>
            </>
          )}
        </Panels>
      </Section>
      <Section
        id="dialogs"
        title="Modal and AlertDialog"
        note="Standalone modal: 3 px translucent frame + 15 px blur + e3, 14vh from the top, no dimming unless `overlay`. Alert: centred 440, overlay 25 % / 55 %."
      >
        <Panels>
          {() => (
            <Row>
              <Button variant="secondary" size={28} onPress={() => setModal('large')}>
                Create record (808)
              </Button>
              <Button variant="secondary" size={28} onPress={() => setModal('overlay')}>
                Invite members (overlay)
              </Button>
              <AlertDialog
                trigger={
                  <Button variant="secondary-destructive" size={28}>
                    Delete folder
                  </Button>
                }
                title="Delete folder"
                description="Are you sure you want to delete this folder?"
              />
              <AlertDialog
                trigger={
                  <Button variant="secondary" size={28}>
                    Change list order
                  </Button>
                }
                title="Change list order"
                description="The new list ordering will be visible for all workspace members."
                variant="primary"
                confirmLabel="Update for everyone"
              />
            </Row>
          )}
        </Panels>
        <Modal isOpen={modal === 'large'} onOpenChange={(o) => !o && setModal(null)} size="large">
          <CreateRecordContent onClose={() => setModal(null)} />
        </Modal>
        <Modal isOpen={modal === 'overlay'} onOpenChange={(o) => !o && setModal(null)} size={720} overlay>
          <DialogHeader
            title="Invite members"
            icon={<IconButton icon="invite" aria-label="Invite" size={20} />}
            onClose={() => setModal(null)}
          />
          <DialogBody>
            <TextInput size={32} label="Send Invite to ..." placeholder="example@email.com" />
          </DialogBody>
          <DialogFooter>
            <Button size={28} shortcut={['mod', 'enter']}>
              Send Invites
            </Button>
          </DialogFooter>
        </Modal>
      </Section>
      <Section
        id="toasts"
        title="Toast"
        note="Top-right, 300–350 wide. Newest in front; older toasts stack 8 px lower, scaled 1 − 0.05·level; hover expands. 4 s, pauses on hover, swipe right dismisses."
      >
        <Panels>
          {() => (
            <>
              <Row>
                <Button variant="secondary" size={28} onPress={() => toast('Copied email address to clipboard')}>
                  Neutral
                </Button>
                <Button
                  variant="secondary"
                  size={28}
                  onPress={() => toast.success('Record created', { description: 'Acme Inc. was added to Companies.' })}
                >
                  Success
                </Button>
                <Button variant="secondary" size={28} onPress={() => toast.warning('Sync is delayed')}>
                  Warning
                </Button>
                <Button
                  variant="secondary"
                  size={28}
                  onPress={() =>
                    toast.error('Failed to create pipeline stage', { action: { label: 'Retry', onAction: () => {} } })
                  }
                >
                  Error + action
                </Button>
                <Button
                  variant="secondary"
                  size={28}
                  onPress={() =>
                    toast('Record deleted', {
                      action: { label: 'Undo', style: 'button', onAction: () => toast.success('Restored') },
                    })
                  }
                >
                  Button action
                </Button>
              </Row>
              <Col>
                <ToastCard title="Copied email address to clipboard" />
                <ToastCard variant="success" title="Record created" description="Acme Inc. was added to Companies." />
                <ToastCard
                  variant="warning"
                  title="Sync is delayed"
                  action={{ label: 'View status', onAction: () => {} }}
                />
                <ToastCard variant="error" title="Failed to create pipeline stage" progress={0.6} />
              </Col>
            </>
          )}
        </Panels>
      </Section>
    </>
  );
}
