import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  AlertDialog,
  Avatar,
  Button,
  Checkbox,
  hueForSeed,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Select,
  SelectItem,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tag,
  TextInput,
  ThemeProvider,
  Toaster,
  ToastStore,
  toHue,
} from '../src';

describe('Button', () => {
  it('fires onPress and exposes variant/size state as data attributes', async () => {
    const onPress = vi.fn();
    render(
      <Button variant="secondary" size={28} icon="add" chevron onPress={onPress}>
        New
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'New' });
    expect(btn.dataset.variant).toBe('secondary');
    expect(btn.dataset.size).toBe('28');
    expect(btn.hasAttribute('data-leading')).toBe(true);
    expect(btn.hasAttribute('data-trailing')).toBe(true);
    await userEvent.click(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled and shows a spinner while pending', async () => {
    const onPress = vi.fn();
    const { rerender } = render(
      <Button isDisabled onPress={onPress}>
        Save
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
    rerender(<Button isPending>Save</Button>);
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('IconButton requires and uses an accessible name', () => {
    render(<IconButton icon="close" aria-label="Close" />);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn.querySelector('svg')).not.toBeNull();
  });
});

describe('Form controls', () => {
  it('TextInput wires label, necessity and error message', () => {
    render(<TextInput label="Name" necessity="optional" isInvalid errorMessage="Required" defaultValue="" />);
    const input = screen.getByRole('textbox', { name: /Name/ });
    expect(screen.getByText('(optional)')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('Checkbox and Switch toggle', async () => {
    const onChange = vi.fn();
    render(
      <>
        <Checkbox onChange={onChange}>Accept</Checkbox>
        <Switch>Create more</Switch>
      </>,
    );
    await userEvent.click(screen.getByText('Accept'));
    expect(onChange).toHaveBeenCalledWith(true);
    const sw = screen.getByRole('switch', { name: 'Create more' });
    await userEvent.click(sw);
    expect((sw as HTMLInputElement).checked).toBe(true);
  });

  it('Select opens a listbox and selects an option', async () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider applyToBody={false}>
        <Select label="Invite as" onSelectionChange={onChange}>
          <SelectItem id="member">Member</SelectItem>
          <SelectItem id="admin">Admin</SelectItem>
        </Select>
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Invite as/ }));
    const listbox = await screen.findByRole('listbox');
    await userEvent.click(within(listbox).getByText('Admin'));
    expect(onChange).toHaveBeenCalledWith('admin');
  });
});

describe('Overlays', () => {
  it('Menu opens from its trigger and runs item actions', async () => {
    const onAction = vi.fn();
    render(
      <ThemeProvider applyToBody={false}>
        <MenuTrigger>
          <Button>Import / Export</Button>
          <Menu aria-label="Import / Export" onAction={onAction}>
            <MenuItem id="migrate" icon="migrate">
              Migrate CRM
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="csv" shortcut={['mod', 'i']}>
              Import CSV
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Import / Export' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2);
    await userEvent.click(within(menu).getByText('Import CSV'));
    expect(onAction.mock.calls[0]?.[0]).toBe('csv');
  });

  it('AlertDialog confirms and cancels', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ThemeProvider applyToBody={false}>
        <AlertDialog
          trigger={<Button>Delete</Button>}
          title="Delete folder"
          description="Are you sure?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete folder')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('Toasts', () => {
  it('store adds newest first, dismisses and notifies', () => {
    const store = new ToastStore();
    const onDismiss = vi.fn();
    const a = store.add('neutral', { title: 'A' });
    store.add('error', { title: 'B', onDismiss });
    expect(store.getSnapshot().map((t) => t.title)).toEqual(['B', 'A']);
    store.dismiss(store.getSnapshot()[0]?.id as string);
    expect(onDismiss).toHaveBeenCalled();
    expect(store.getSnapshot().map((t) => t.id)).toEqual([a]);
  });

  it('Toaster renders toasts in a labelled region and auto-dismisses after 4 s', () => {
    vi.useFakeTimers();
    const store = new ToastStore();
    render(
      <ThemeProvider applyToBody={false}>
        <Toaster store={store} />
      </ThemeProvider>,
    );
    act(() => {
      store.add('neutral', { title: 'Copied to clipboard' });
    });
    expect(screen.getByRole('region', { name: 'Notifications (F8)' })).toBeTruthy();
    expect(screen.getByText('Copied to clipboard')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(store.getSnapshot()).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe('Navigation and display', () => {
  it('Tabs switch panels', async () => {
    render(
      <Tabs>
        <TabList aria-label="Record">
          <Tab id="a">Activity</Tab>
          <Tab id="b" count={3}>
            Notes
          </Tab>
        </TabList>
        <TabPanel id="a">Activity panel</TabPanel>
        <TabPanel id="b">Notes panel</TabPanel>
      </Tabs>,
    );
    await userEvent.click(screen.getByRole('tab', { name: /Notes/ }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Notes panel');
  });

  it('Avatar falls back to the initial on a seeded hue', () => {
    render(<Avatar name="ilya" seed="user-1" />);
    expect(screen.getByRole('img', { name: 'ilya' }).textContent).toBe('I');
    expect(hueForSeed('user-1')).toBe(hueForSeed('user-1'));
  });

  it('maps stored colour keys to hues', () => {
    expect(toHue('pastel_teal')).toBe('cyan');
    expect(toHue('block_light-green')).toBe('lime');
    expect(toHue('pastel_brown')).toBe('amber');
    expect(toHue('block_violet')).toBe('lavender');
    expect(toHue('red')).toBe('red');
    expect(toHue('nonsense')).toBe('grey');
    render(<Tag color="pastel_magenta">Hot</Tag>);
    expect(screen.getByText('Hot')).toBeTruthy();
  });
});
