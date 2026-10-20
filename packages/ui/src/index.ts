// @agentic-crm/ui — design system: tokens, themes, primitives.
//
// Usage: wrap the app once in <ThemeProvider> (writes theme classes onto <body>, loads Inter)
// and mount <Toaster /> once. Everything else is a plain component import.
// Exports are kept sorted by module path (Biome organize-imports).

export {
  Avatar,
  AvatarGroup,
  type AvatarGroupProps,
  type AvatarKind,
  type AvatarProps,
  type AvatarSize,
  IconTile,
  type IconTileProps,
} from './components/Avatar/Avatar';
export {
  Badge,
  type BadgeProps,
  type BadgeVariant,
  Chip,
  type ChipProps,
  type ChipVariant,
  Status,
  StatusDot,
  type StatusDotProps,
  type StatusProps,
  Tag,
  type TagProps,
} from './components/Badge/Badge';
export { type BreadcrumbItem, Breadcrumbs, type BreadcrumbsProps } from './components/Breadcrumbs/Breadcrumbs';
export {
  Button,
  ButtonGroup,
  type ButtonGroupProps,
  type ButtonIcon,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  buttonStyles,
} from './components/Button/Button';
export { IconButton, type IconButtonProps } from './components/Button/IconButton';
export {
  Checkbox,
  type CheckboxProps,
  Radio,
  RadioGroup,
  type RadioGroupProps,
  type RadioProps,
  Switch,
  type SwitchProps,
} from './components/Checkbox/Checkbox';
export {
  AlertDialog,
  type AlertDialogProps,
  DialogBody,
  DialogFooter,
  type DialogFooterProps,
  DialogHeader,
  type DialogHeaderProps,
  Modal,
  type ModalProps,
  type ModalSize,
} from './components/Dialog/Dialog';
export {
  AnnouncementBanner,
  type AnnouncementBannerProps,
  type AnnouncementScheme,
  Banner,
  type BannerProps,
  type BannerVariant,
  Card,
  type CardProps,
  Divider,
  type DividerProps,
  EmptyState,
  type EmptyStateProps,
  ErrorState,
  type ErrorStateProps,
  LoadingState,
  Skeleton,
  type SkeletonProps,
} from './components/Feedback/Feedback';
export {
  type FieldChromeProps,
  FieldDescription,
  FieldErrorMessage,
  FieldLabel,
  type FieldNecessity,
} from './components/Field/Field';
export { HoverCard, type HoverCardProps } from './components/HoverCard/HoverCard';
export { SearchField, type SearchFieldProps } from './components/Input/SearchField';
export { TextArea, type TextAreaProps } from './components/Input/TextArea';
export { type InputSize, TextInput, type TextInputProps } from './components/Input/TextInput';
export { formatKey, Kbd, type KbdProps, type KbdSize, type KbdVariant } from './components/Kbd/Kbd';
export {
  ContextMenu,
  type ContextMenuProps,
  FilterableMenu,
  type FilterableMenuProps,
  Menu,
  MenuItem,
  type MenuItemProps,
  type MenuItemVariant,
  MenuList,
  type MenuProps,
  MenuSection,
  type MenuSectionProps,
  MenuSeparator,
  MenuTrigger,
  type MenuTriggerProps,
  Submenu,
  type SubmenuProps,
} from './components/Menu/Menu';
export {
  AccentPicker,
  type AccentPickerProps,
  NavItem,
  type NavItemProps,
  NavList,
  NavSectionLabel,
} from './components/Nav/Nav';
export { Popover, PopoverPanel, type PopoverPanelProps, type PopoverProps } from './components/Popover/Popover';
export {
  ComboBox,
  type ComboBoxProps,
  Select,
  SelectItem,
  type SelectItemProps,
  type SelectProps,
  SelectSection,
  type SelectSectionProps,
  type SelectSize,
} from './components/Select/Select';
export { Spinner, type SpinnerProps } from './components/Spinner/Spinner';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
  Tab,
  TabList,
  type TabListProps,
  TabPanel,
  type TabProps,
  Tabs,
  type TabsProps,
} from './components/Tabs/Tabs';
export {
  Heading,
  type HeadingProps,
  type HeadingSize,
  Text,
  type TextProps,
  type TextVariant,
} from './components/Text/Text';
export {
  type ToastAction,
  type ToastOptions,
  type ToastRecord,
  ToastStore,
  type ToastVariant,
  toast,
  toastStore,
} from './components/Toast/store';
export { ToastCard, type ToastCardProps, Toaster, type ToasterProps } from './components/Toast/Toast';
export { Tooltip, type TooltipProps } from './components/Tooltip/Tooltip';
export { CheckCircleFilled, DotFilled } from './icons/custom';
export { Icon, type IconOpticalSize, type IconProps, opticalSize, STROKE_BY_OPTICAL_SIZE } from './icons/Icon';
export { type IconName, iconMap, iconNames } from './icons/iconMap';
export type { IconGlyph } from './icons/types';
export {
  ACCENT_STORAGE_KEY,
  suppressTransitionsForOneTick,
  THEME_STORAGE_KEY,
  ThemeLayer,
  ThemeProvider,
  type ThemeProviderProps,
  type ThemeSettings,
  type ThemeState,
  themeClassName,
  useTheme,
  useThemeClassName,
  useThemeSettings,
} from './theme/ThemeProvider';
export { resolveTextColor, type TextColor, type TextRule, text, textColor } from './theme/text';
export { derivedVars, type ThemeVars, vars } from './theme/vars.css';
export * from './tokens';
export {
  type AvatarHue,
  avatarHues,
  type ColorInput,
  hueForSeed,
  type SelectOptionColor,
  type StatusColor,
  selectOptionColors,
  statusColors,
  toHue,
} from './utils/colors';
export { cx } from './utils/cx';
