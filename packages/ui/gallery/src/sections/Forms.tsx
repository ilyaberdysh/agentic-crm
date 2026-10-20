import {
  Checkbox,
  ComboBox,
  Radio,
  RadioGroup,
  SearchField,
  Select,
  SelectItem,
  SelectSection,
  Switch,
  TextArea,
  TextInput,
} from '../../../src';
import { Col, Panels, Row, Section } from '../kit';

const people = [
  { id: 'member', name: 'Member' },
  { id: 'admin', name: 'Admin' },
  { id: 'guest', name: 'Guest' },
];

export function Forms() {
  return (
    <>
      <Section
        id="inputs"
        title="TextInput, TextArea, SearchField"
        note="Hairline ring (black 6 %), hover black 2 %, focus accent, error critical, read-only black 2 %, disabled 40 %."
      >
        <Panels>
          {() => (
            <>
              <Row top>
                {([28, 32, 34] as const).map((size) => (
                  <div key={size} style={{ width: 200 }}>
                    <TextInput size={size} label={`Size ${size}`} placeholder="Set name" />
                  </div>
                ))}
              </Row>
              <Row top>
                <div style={{ width: 200 }}>
                  <TextInput
                    size={32}
                    label="Domains"
                    necessity="optional"
                    placeholder="Set domains"
                    icon="attrDomain"
                  />
                </div>
                <div style={{ width: 200 }}>
                  <TextInput size={32} label="Website" prefix="https://" defaultValue="mymeet.ai" />
                </div>
                <div style={{ width: 200 }}>
                  <TextInput size={32} label="Budget" suffix="USD" defaultValue="12,000" />
                </div>
              </Row>
              <Row top>
                <div style={{ width: 200 }}>
                  <TextInput
                    size={32}
                    label="Invalid"
                    isInvalid
                    defaultValue="not-an-email"
                    errorMessage="Enter a valid email"
                  />
                </div>
                <div style={{ width: 200 }}>
                  <TextInput
                    size={32}
                    label="Read only"
                    isReadOnly
                    defaultValue="Read only"
                    description="Managed by SCIM"
                  />
                </div>
                <div style={{ width: 200 }}>
                  <TextInput size={32} label="Disabled" isDisabled defaultValue="Disabled" />
                </div>
              </Row>
              <Row top>
                <div style={{ width: 300 }}>
                  <TextArea label="Send invite to ..." placeholder="example@email.com" rows={4} />
                </div>
                <Col>
                  <div style={{ width: 240 }}>
                    <SearchField placeholder="Search settings..." aria-label="Search settings" />
                  </div>
                  <div style={{ width: 240 }}>
                    <SearchField size={32} defaultValue="Acme" aria-label="Search" />
                  </div>
                </Col>
              </Row>
            </>
          )}
        </Panels>
      </Section>
      <Section id="toggles" title="Checkbox, Radio, Switch">
        <Panels>
          {() => (
            <>
              <Row label="checkbox 16">
                <Checkbox aria-label="Unchecked" />
                <Checkbox aria-label="Checked" defaultSelected />
                <Checkbox aria-label="Indeterminate" isIndeterminate />
                <Checkbox aria-label="Disabled" isDisabled />
                <Checkbox aria-label="Round" shape="round" defaultSelected />
                <Checkbox defaultSelected>With label</Checkbox>
              </Row>
              <Row label="checkbox 20">
                <Checkbox size={20} aria-label="Unchecked" />
                <Checkbox size={20} aria-label="Checked" defaultSelected />
                <Checkbox size={20} aria-label="Indeterminate" isIndeterminate />
                <Checkbox size={20} isInvalid aria-label="Invalid" />
              </Row>
              <Row label="radio" top>
                <RadioGroup aria-label="Theme" defaultValue="light" orientation="horizontal">
                  <Radio value="light">Light</Radio>
                  <Radio value="dark">Dark</Radio>
                  <Radio value="system" isDisabled>
                    System
                  </Radio>
                </RadioGroup>
                <RadioGroup aria-label="Size" defaultValue="b" orientation="horizontal">
                  <Radio size={20} value="a">
                    20 off
                  </Radio>
                  <Radio size={20} value="b">
                    20 on
                  </Radio>
                </RadioGroup>
              </Row>
              <Row label="switch">
                <Switch aria-label="Off" />
                <Switch aria-label="On" defaultSelected />
                <Switch size={20} aria-label="Off 20" />
                <Switch size={20} aria-label="On 20" defaultSelected />
                <Switch size={24} aria-label="Off 24" />
                <Switch size={24} aria-label="On 24" defaultSelected />
                <Switch isDisabled aria-label="Disabled" />
                <Switch>Create more</Switch>
              </Row>
            </>
          )}
        </Panels>
      </Section>
      <Section
        id="selects"
        title="Select, searchable Select, ComboBox"
        note="Trigger sizes 20 / 22 / 28 / 32 / 36, default or ghost; list 8 px below in the menu chrome; selected item shows the accent check."
      >
        <Panels>
          {() => (
            <>
              <Row top>
                {([20, 22, 28, 32, 36] as const).map((size) => (
                  <div key={size} style={{ width: size < 28 ? 120 : 160 }}>
                    <Select size={size} aria-label={`Size ${size}`} items={people} defaultSelectedKey="member">
                      {(item) => <SelectItem id={item.id}>{item.name}</SelectItem>}
                    </Select>
                  </div>
                ))}
              </Row>
              <Row top>
                <div style={{ width: 220 }}>
                  <Select label="Invite as" items={people} defaultSelectedKey="member">
                    {(item) => <SelectItem id={item.id}>{item.name}</SelectItem>}
                  </Select>
                </div>
                <div style={{ width: 220 }}>
                  <Select label="Placeholder" necessity="optional" items={people}>
                    {(item) => <SelectItem id={item.id}>{item.name}</SelectItem>}
                  </Select>
                </div>
                <div style={{ width: 220 }}>
                  <Select label="Ghost" variant="ghost" items={people} defaultSelectedKey="admin">
                    {(item) => <SelectItem id={item.id}>{item.name}</SelectItem>}
                  </Select>
                </div>
              </Row>
              <Row top>
                <div style={{ width: 220 }}>
                  <Select label="Searchable" searchable placeholder="Search or create a team">
                    <SelectSection title="Teams">
                      <SelectItem id="sales" icon="people">
                        Sales
                      </SelectItem>
                      <SelectItem id="cs" icon="people">
                        Customer success
                      </SelectItem>
                      <SelectItem id="eng" icon="people" description="12 members">
                        Engineering
                      </SelectItem>
                    </SelectSection>
                  </Select>
                </div>
                <div style={{ width: 220 }}>
                  <ComboBox label="ComboBox" placeholder="Country" defaultItems={people}>
                    {(item) => <SelectItem id={item.id}>{item.name}</SelectItem>}
                  </ComboBox>
                </div>
                <div style={{ width: 220 }}>
                  <Select label="Invalid" isInvalid errorMessage="Required" items={people}>
                    {(item) => <SelectItem id={item.id}>{item.name}</SelectItem>}
                  </Select>
                </div>
              </Row>
            </>
          )}
        </Panels>
      </Section>
    </>
  );
}
