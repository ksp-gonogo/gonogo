// Types-only, emits no runtime code — but NOT removable. It pulls the
// `DefaultTheme` augmentation into the declaration build's program, which is
// built from this entry graph rather than tsconfig's `include`. Drop it and
// `pnpm build` fails on `theme.space` in Box/Stack. See the file's own header.
import "./styledComponentsTheme";

// ── Theme ────────────────────────────────────────────────────────────────────
// Re-exported wholesale from `@ksp-gonogo/theme`, an internal `private: true`
// package that is never published — the build inlines it into `dist` (JS and
// `.d.ts` alike), so this is the theme's only public surface. The split exists
// so packages needing only a theme (`@ksp-gonogo/test-utils`) don't pull in the
// whole kit; it must stay a devDependency so it can't leak into the published
// manifest. See `tsup.config.ts`.
export * from "@ksp-gonogo/theme";
export {
  ActionButton,
  type ActionButtonProps,
  type ActionButtonTone,
} from "./ActionButton";
export {
  type AugmentSettingField,
  AugmentSettingsPanel,
  type AugmentSettingsPanelProps,
  type NamespacedAugmentSettings,
} from "./AugmentSettingsPanel";
export {
  Badge,
  type BadgeProps,
  type BadgeSize,
  type BadgeTone,
} from "./Badge";
export {
  Box,
  type BoxPad,
  type BoxProps,
  type BoxRadius,
  type BoxSurface,
} from "./Box";
export {
  Button,
  GhostButton,
  IconButton,
  PrimaryButton,
  TextButton,
} from "./Button";
export { Card, type CardProps } from "./Card";
export { Cluster, type ClusterJustify, type ClusterProps } from "./Cluster";
export {
  ComboboxListbox,
  type ComboboxListboxProps,
  type ComboboxOption,
  comboboxOptionMatches,
  filterComboboxOptions,
  flattenComboboxGroups,
  groupComboboxOptions,
  moveComboboxActiveIndex,
} from "./Combobox";
export { configEqual } from "./configEqual";
export {
  DataKeyPicker,
  type DataKeyPickerProps,
  type KeyOption,
} from "./DataKeyPicker";
// ── Leaf components ──────────────────────────────────────────────────────────
export {
  EmptyState,
  type EmptyStateLayout,
  type EmptyStateProps,
} from "./EmptyState";
export {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  FieldRow,
  FormActions,
  Input,
  Select,
  Textarea,
} from "./Form";
// ── Formatters ───────────────────────────────────────────────────────────────
export { type FormatNumberOptions, formatNumber } from "./format";
export { formatAge, formatAgeLong } from "./formatAge";
export {
  type FormatDurationOptions,
  formatCountdown,
  formatDuration,
} from "./formatDuration";
export { formatKspDate } from "./formatKspDate";
export { Grid, type GridProps } from "./Grid";
export {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BellIcon,
  BroadcastIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  DatabaseIcon,
  DiagnosticsIcon,
  FullHeightIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  FullWidthIcon,
  GearIcon,
  HalfHeightIcon,
  HalfWidthIcon,
  HistoryIcon,
  type IconProps,
  JoystickIcon,
  LayersIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  PushUpIcon,
  RecallIcon,
  SatelliteIcon,
  SettingsIcon,
  StarIcon,
  StopIcon,
} from "./Icons";
export { Inline, type InlineProps } from "./Inline";
export {
  ModalChromeContext,
  type ModalChromeValue,
  type ModalSaveBarOptions,
  useModalChrome,
  useModalSaveBar,
} from "./ModalSaveBar";
// ── Panel family ─────────────────────────────────────────────────────────────
export { Panel, PanelSubtitle, PanelTitle, ScrollArea } from "./Panel";
export { ProgressBar, type ProgressBarProps } from "./ProgressBar";
export {
  BigReadout,
  Readout,
  ReadoutCaption,
  type ReadoutTone,
  StatusPill,
} from "./Readout";
export { Row, RowName, type RowProps } from "./Row";
export { Section, type SectionProps, SectionTitle } from "./Section";
export { Spinner, type SpinnerProps } from "./Spinner";
// ── Layout primitives ────────────────────────────────────────────────────────
export { type SpaceToken, Stack, type StackProps } from "./Stack";
export {
  StatusIndicator,
  type StatusIndicatorProps,
  type StatusTone,
} from "./StatusIndicator";
export { Switch } from "./Switch";
export {
  ScienceExperimentRow,
  type ScienceExperimentRowProps,
  type ScienceInstrument,
} from "./science/ScienceExperimentRow";
export { Truncate } from "./Truncate";
export { type ElementSize, useElementSize } from "./useElementSize";
export {
  Value,
  type ValueProps,
  type ValueSize,
  type ValueTone,
} from "./Value";
export { WidgetHeader, type WidgetHeaderProps } from "./WidgetHeader";
