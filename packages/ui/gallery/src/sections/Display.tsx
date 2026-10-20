import {
  AccentPicker,
  Avatar,
  AvatarGroup,
  type AvatarSize,
  Badge,
  Breadcrumbs,
  Chip,
  hues,
  IconTile,
  NavItem,
  NavList,
  NavSectionLabel,
  SegmentedControl,
  Status,
  StatusDot,
  selectOptionColors,
  statusColors,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tag,
  Text,
} from '../../../src';
import { Panels, Row, Section } from '../kit';

const avatarSizes: AvatarSize[] = [12, 16, 18, 20, 22, 24, 26, 28, 32, 34, 40, 44, 56, 64, 72];
const names = [
  'Ilya Ivanov',
  'Maria Lopez',
  'Kenji Sato',
  'Amara Okafor',
  'Jonas Berg',
  'Priya Nair',
  'Noah Kim',
  'Zoe Martin',
];

export function Navigation() {
  return (
    <>
      <Section id="tabs" title="Tabs, SegmentedControl, Breadcrumbs">
        <Panels>
          {() => (
            <>
              <Tabs defaultSelectedKey="activity">
                <TabList aria-label="Record tabs">
                  <Tab id="overview" icon="home">
                    Overview
                  </Tab>
                  <Tab id="activity" icon="history">
                    Activity
                  </Tab>
                  <Tab id="emails" icon="emails" count={12}>
                    Emails
                  </Tab>
                  <Tab id="notes" icon="notes" count={3}>
                    Notes
                  </Tab>
                  <Tab id="files" icon="attach" isDisabled>
                    Files
                  </Tab>
                </TabList>
                <TabPanel id="overview">
                  <Text>Overview panel</Text>
                </TabPanel>
                <TabPanel id="activity" style={{ paddingTop: 12 }}>
                  <Text>Activity panel</Text>
                </TabPanel>
                <TabPanel id="emails">
                  <Text>Emails panel</Text>
                </TabPanel>
                <TabPanel id="notes">
                  <Text>Notes panel</Text>
                </TabPanel>
                <TabPanel id="files">
                  <Text>Files</Text>
                </TabPanel>
              </Tabs>
              <Row label="segmented">
                <SegmentedControl
                  aria-label="Layout"
                  defaultValue="table"
                  options={[
                    { id: 'table', label: 'Table', icon: 'table' },
                    { id: 'board', label: 'Board', icon: 'kanban' },
                    { id: 'list', label: 'List', icon: 'list' },
                  ]}
                />
                <SegmentedControl
                  aria-label="Period"
                  size={32}
                  defaultValue="m"
                  options={[
                    { id: 'w', label: 'Week' },
                    { id: 'm', label: 'Month' },
                    { id: 'q', label: 'Quarter' },
                    { id: 'y', label: 'Year' },
                  ]}
                />
                <SegmentedControl
                  aria-label="Theme"
                  defaultValue="light"
                  options={[
                    { id: 'light', icon: 'themeLight', 'aria-label': 'Light' },
                    { id: 'dark', icon: 'themeDark', 'aria-label': 'Dark' },
                    { id: 'system', icon: 'themeSystem', 'aria-label': 'System' },
                  ]}
                />
              </Row>
              <Row label="breadcrumbs">
                <Breadcrumbs
                  items={[
                    { id: 'companies', label: 'Companies', icon: <IconTile icon="company" color="blue" /> },
                    { id: 'acme', label: 'Acme Inc.' },
                    { id: 'notes', label: 'Notes', icon: 'notes' },
                  ]}
                />
              </Row>
            </>
          )}
        </Panels>
      </Section>
      <Section
        id="nav"
        title="Navigation items, accent picker"
        note="Sidebar / settings rows (28 px, radius 9, 1 px gap): hover black 2 %, current black 4 %."
      >
        <Panels secondary>
          {() => (
            <Row top>
              <div style={{ width: 258 }}>
                <NavSectionLabel>Personal</NavSectionLabel>
                <NavList aria-label="Settings">
                  <NavItem icon="person">Profile</NavItem>
                  <NavItem icon="theme" isCurrent>
                    Appearance
                  </NavItem>
                  <NavItem icon="emails">Email and calendar accounts</NavItem>
                  <NavItem icon="tasks" trailing={<Badge>2</Badge>}>
                    Tasks
                  </NavItem>
                  <NavItem icon={<IconTile icon="company" color="blue" />}>Companies</NavItem>
                  <NavItem icon="deal" isDisabled>
                    Deals
                  </NavItem>
                </NavList>
              </div>
              <AccentPicker defaultValue="blue" />
            </Row>
          )}
        </Panels>
      </Section>
    </>
  );
}

export function Display() {
  return (
    <>
      <Section
        id="avatars"
        title="Avatar, AvatarGroup, IconTile"
        note="Fallback initial on a hue hashed from the seed; person/member round, company/workspace box (30 %)."
      >
        <Panels>
          {() => (
            <>
              <Row label="person">
                {avatarSizes.map((size, i) => (
                  <Avatar key={size} name={names[i % names.length] as string} size={size} />
                ))}
              </Row>
              <Row label="company">
                {avatarSizes.map((size, i) => (
                  <Avatar
                    key={size}
                    kind="company"
                    name={['Acme', 'Globex', 'Initech', 'Umbrella'][i % 4] as string}
                    size={size}
                  />
                ))}
              </Row>
              <Row label="subtle, absent">
                {names.map((n) => (
                  <Avatar key={n} name={n} appearance="subtle" size={28} />
                ))}
                <Avatar name="Offline" present={false} size={28} />
                <Avatar name="Broken image" src="/does-not-exist.png" size={28} />
              </Row>
              <Row label="group">
                {([16, 20, 24, 32] as const).map((size) => (
                  <AvatarGroup key={size} size={size} max={4} items={names.map((n) => ({ name: n }))} />
                ))}
              </Row>
              <Row label="icon tile">
                {([16, 20, 24, 28, 32, 40] as const).map((size) => (
                  <IconTile key={size} icon="company" size={size} />
                ))}
                {hues.map((h) => (
                  <IconTile key={h} icon="object" color={h} size={20} />
                ))}
                <IconTile icon="favorite" color="accent" size={20} />
              </Row>
            </>
          )}
        </Panels>
      </Section>
      <Section
        id="tags"
        title="Badge, Tag, Status, Chip"
        note="Tags take a hue or the stored colour key: select options `pastel_*`, statuses `block_*`."
      >
        <Panels>
          {() => (
            <>
              <Row label="badge">
                {(['primary', 'secondary', 'tertiary', 'warning', 'danger', 'ghost'] as const).map((v) => (
                  <Badge key={v} variant={v}>
                    {v === 'primary' ? 2 : v}
                  </Badge>
                ))}
                <Badge size={14}>9</Badge>
                <Badge size={20} variant="secondary">
                  128
                </Badge>
              </Row>
              <Row label="pastel_* 20">
                {selectOptionColors.map((c) => (
                  <Tag key={c} color={c}>
                    {c.replace('pastel_', '')}
                  </Tag>
                ))}
              </Row>
              <Row label="hues 22">
                {hues.map((h) => (
                  <Tag key={h} color={h} size={22} icon="attrMultiSelect" onRemove={() => {}}>
                    {h}
                  </Tag>
                ))}
              </Row>
              <Row label="block_*">
                {statusColors.map((c) => (
                  <Status key={c} color={c}>
                    {c.replace('block_', '')}
                  </Status>
                ))}
              </Row>
              <Row label="dots">
                {([6, 8, 10, 14] as const).map((s) => (
                  <StatusDot key={s} size={s} color="green" />
                ))}
              </Row>
              <Row label="chip">
                {(
                  [
                    'primary',
                    'secondary',
                    'link',
                    'preview',
                    'external-link',
                    'error',
                    'stroke-primary',
                    'stroke-secondary',
                  ] as const
                ).map((v) => (
                  <Chip key={v} variant={v} onPress={() => {}}>
                    {v}
                  </Chip>
                ))}
              </Row>
              <Row label="chip 22">
                <Chip size={22} leading={<Avatar name="Ilya Ivanov" size={16} />} onPress={() => {}}>
                  Ilya Ivanov
                </Chip>
                <Chip
                  size={22}
                  leading={<Avatar kind="company" name="Acme" size={16} />}
                  variant="link"
                  onPress={() => {}}
                >
                  Acme Inc.
                </Chip>
                <Chip size={22} icon="attrEmail" suffix={{ icon: 'close', label: 'Remove', onPress: () => {} }}>
                  ilya@mymeet.ai
                </Chip>
                <Chip size={22} isDisabled onPress={() => {}}>
                  Disabled
                </Chip>
              </Row>
            </>
          )}
        </Panels>
      </Section>
    </>
  );
}
