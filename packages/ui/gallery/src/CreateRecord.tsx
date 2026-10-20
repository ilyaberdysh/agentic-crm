// The create-record dialog content (layout.md §8), used by the gallery and the modal parity frame.
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconTile,
  Switch,
  Tab,
  TabList,
  Tabs,
  Text,
  TextInput,
} from '../../src';

export function CreateRecordContent({ onClose }: { onClose?: () => void }) {
  return (
    <>
      <DialogHeader
        icon={<IconTile icon="company" color="blue" />}
        title="Create Company"
        onClose={onClose ?? (() => {})}
      />
      <Tabs defaultSelectedKey="all" style={{ padding: '7px 12px 0', flex: 'none' }}>
        <TabList aria-label="Create record">
          <Tab id="all">All</Tab>
          <Tab id="templates" icon="template" divider>
            Create templates
          </Tab>
        </TabList>
      </Tabs>
      <DialogBody style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Text variant="heading.extraSmall" as="h3">
          All
        </Text>
        {['Domains', 'Name', 'Description', 'Team', 'Categories'].map((f) => (
          <TextInput key={f} size={32} label={f} necessity="optional" placeholder={`Set ${f.toLowerCase()}`} />
        ))}
      </DialogBody>
      <DialogFooter>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Switch>Create more</Switch>
          <Button size={28} shortcut={['mod', 'enter']}>
            Create record
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
