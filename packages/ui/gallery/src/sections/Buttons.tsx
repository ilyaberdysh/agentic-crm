import {
  Button,
  ButtonGroup,
  type ButtonSize,
  type ButtonVariant,
  IconButton,
  IconTile,
  Kbd,
  Spinner,
} from '../../../src';
import { Panels, Row, Section } from '../kit';

const variants: ButtonVariant[] = ['primary', 'secondary', 'secondary-destructive', 'ghost', 'destructive'];
const sizes: ButtonSize[] = ['20', '20s', '20l', 28, 32, 36];

export function Buttons() {
  return (
    <>
      <Section
        id="buttons"
        title="Button"
        note="Variants × sizes (20 / 20s / 20l / 28 / 32 / 36). Toolbars use 28. Hover, press and focus-visible are live."
      >
        <Panels>
          {() => (
            <>
              {variants.map((variant) => (
                <Row key={variant} label={variant}>
                  {sizes.map((size) => (
                    <Button key={size} variant={variant} size={size}>
                      Button {size}
                    </Button>
                  ))}
                </Row>
              ))}
              <Row label="icon + chevron">
                <Button variant="secondary" size={28} icon="importExport" chevron>
                  Import / Export
                </Button>
                <Button size={28} icon="add">
                  New Company
                </Button>
                <Button variant="secondary" size={28} icon={<IconTile icon="apps" color="green" />} chevron>
                  All Companies
                </Button>
                <Button variant="ghost" size={28} icon="share">
                  Share
                </Button>
              </Row>
              <Row label="badge, shortcut">
                <Button size={28} shortcut={['mod', 'enter']}>
                  Create record
                </Button>
                <Button variant="secondary" size={28} badge={3}>
                  Filters
                </Button>
                <Button size={28} badge={12}>
                  Inbox
                </Button>
                <Button variant="secondary" size={32} shortcut={['mod', 'k']}>
                  Search
                </Button>
              </Row>
              <Row label="states">
                <Button variant="secondary" size={28} isActive>
                  Active
                </Button>
                <Button size={28} isDisabled>
                  Disabled
                </Button>
                <Button variant="secondary" size={28} isDisabled>
                  Disabled
                </Button>
                <Button size={28} isPending>
                  Saving
                </Button>
                <Button variant="ghost" size={28} isActive>
                  Ghost active
                </Button>
              </Row>
              <Row label="full width">
                <Button variant="secondary" size={32} fullWidth>
                  Full width
                </Button>
              </Row>
            </>
          )}
        </Panels>
      </Section>
      <Section id="icon-buttons" title="IconButton, ButtonGroup, Kbd, Spinner">
        <Panels>
          {() => (
            <>
              <Row label="icon buttons">
                {sizes.map((size) => (
                  <IconButton key={size} icon="more" aria-label="More" size={size} />
                ))}
                <IconButton
                  icon="sidebar"
                  aria-label="Collapse sidebar"
                  tooltip="Collapse sidebar"
                  tooltipShortcut={['mod', '.']}
                />
                <IconButton icon="add" aria-label="Add" variant="secondary" />
                <IconButton icon="add" aria-label="Add" variant="primary" />
                <IconButton icon="delete" aria-label="Delete" variant="secondary-destructive" />
              </Row>
              <Row label="group">
                <ButtonGroup aria-label="View">
                  <Button variant="secondary" size={28} icon="table">
                    Table
                  </Button>
                  <Button variant="secondary" size={28} icon="kanban">
                    Board
                  </Button>
                  <IconButton variant="secondary" size={28} icon="chevronDown" aria-label="More views" />
                </ButtonGroup>
              </Row>
              <Row label="kbd">
                {([14, 16, 18, 20] as const).map((size) => (
                  <Kbd key={size} keys={['mod', 'k']} size={size} />
                ))}
                <Kbd keys={['enter']} size={20} />
                <Kbd keys={['tab']} size={16} />
                <Kbd keys={['shift', 'esc']} size={18} />
              </Row>
              <Row label="spinner">
                {[10, 12, 16, 20, 24].map((size) => (
                  <Spinner key={size} size={size} color="secondary" />
                ))}
                <Spinner size={16} color="accent" />
              </Row>
            </>
          )}
        </Panels>
      </Section>
    </>
  );
}
