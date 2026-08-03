// Types-only, emits no runtime code: but NOT removable. It pulls the
// `DefaultTheme` augmentation into the declaration build's program, which is
// built from this entry graph rather than tsconfig's `include`. Drop it and
// `pnpm build` fails on `theme.space` in Box/Stack. See the file's own header.
import "./styledComponentsTheme";

// ── Theme ────────────────────────────────────────────────────────────────────
// Re-exported wholesale from `@ksp-gonogo/theme`, an internal `private: true`
// package that is never published, the build inlines it into `dist` (JS and
// `.d.ts` alike), so this is the theme's only public surface. The split exists
// so packages needing only a theme (`@ksp-gonogo/test-utils`) don't pull in the
// whole kit; it must stay a devDependency so it can't leak into the published
// manifest. See `tsup.config.ts`.
//
// Token convention for everything in this package: `@ksp-gonogo/ui-kit/tokens.css`
// is the one way a host mounts the tokens, and it is a build-time copy of the
// theme's `tokens.css`, so it cannot drift from it.
//
// There used to be a second route, a `GonogoTokens` styled-components global
// sheet, for hosts that build their global styles in JS. It was a hand-typed
// copy of the same values, nothing consumed it, and it fell 39 properties
// behind without anyone noticing. Removed rather than automated: a consumer
// that can install this package can import a stylesheet.
//
// The inline fallbacks written through this package (`var(--space-8, 8px)`)
// are the last line of defence for a host that mounts NO sheet: they keep a
// padding from computing to its initial `0` and collapsing the layout. Colours
// degrade to inherited text and are left bare, matching what shipped before.
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
export {
  Cluster,
  type ClusterAlign,
  type ClusterJustify,
  type ClusterProps,
} from "./Cluster";
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
export {
  CommandGroup,
  type CommandGroupProps,
} from "./CommandDelay/CommandGroup";
export {
  ControlDelayStream,
  type ControlDelayStreamProps,
  type ControlStreamDatum,
  type ControlStreamSample,
} from "./CommandDelay/ControlDelayStream";
export {
  InFlightList,
  type InFlightListDensity,
  type InFlightListItem,
  type InFlightListMode,
  type InFlightListProps,
  useCountdown,
} from "./CommandDelay/InFlightList";
export { configEqual } from "./configEqual";
export {
  DataKeyPicker,
  type DataKeyPickerProps,
  type KeyOption,
} from "./DataKeyPicker";
export {
  Dial,
  type DialProps,
  type DialTick,
  type DialZone,
} from "./Dial";
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
export {
  FramedDisplay,
  type FramedDisplayProps,
} from "./FramedDisplay";
// ── Formatters ───────────────────────────────────────────────────────────────
export { type FormatNumberOptions, formatNumber } from "./format";
export { formatAge, formatAgeLong } from "./formatAge";
export {
  type FormatDurationOptions,
  formatCountdown,
  formatDuration,
} from "./formatDuration";
export { formatKspDate } from "./formatKspDate";
export { Grid, type GridAlign, type GridProps } from "./Grid";
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
  HeartIcon,
  HistoryIcon,
  type IconProps,
  JoystickIcon,
  LayersIcon,
  MicroscopeIcon,
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
export { JogWheel, type JogWheelProps } from "./JogWheel";
export {
  KSP_DAY_SECONDS,
  KSP_YEAR_DAYS,
  KSP_YEAR_SECONDS,
} from "./kspTime";
export {
  ModalChromeContext,
  type ModalChromeValue,
  type ModalSaveBarOptions,
  useModalChrome,
  useModalSaveBar,
} from "./ModalSaveBar";
// ── Null-display token ──────────────────────────────────────────────────────
// The one sanctioned em dash in the codebase; see NullValue.tsx's own header
// comment for the full rationale and the ratchet that enforces it.
export { NULL_DISPLAY, NullValue } from "./NullValue";
// ── Panel family ─────────────────────────────────────────────────────────────
// `Panel` is a compound component: `Panel.Container`, `.Title`, `.Subtitle`,
// `.Toolbar`, `.Glow`, `.Body`, `.Split` and `.Sidebar` are reachable from it, so
// a widget that needs
// a variant can hand-compose the same arrangement. The named exports below are the same
// objects, kept for widgets that render them as children; prefer
// `<Panel panelTitle="…">` in new code. See README.md's Panel section.
export {
  Panel,
  PanelBody,
  PanelContainer,
  PanelContextProvider,
  PanelGlow,
  PanelHeader,
  type PanelProps,
  PanelSidebar,
  type PanelSidebarSide,
  PanelSplit,
  type PanelSplitProps,
  PanelStatusProvider,
  PanelSubtitle,
  PanelTitle,
  PanelToolbar,
  ScrollArea,
  usePanelStreamStatus,
} from "./Panel";
export { ProgressBar, type ProgressBarProps } from "./ProgressBar";
export { Quantity, type QuantityProps } from "./Quantity";
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
export {
  formatStreamStatus,
  StreamStatusBadge,
  type StreamStatusBadgeProps,
} from "./StreamStatusBadge";
export { Switch } from "./Switch";
export {
  ScienceExperimentRow,
  type ScienceExperimentRowProps,
  type ScienceInstrument,
} from "./science/ScienceExperimentRow";
export {
  Tape,
  type TapeMarker,
  type TapeProps,
  type TapeZone,
} from "./Tape";
// Switch's sibling, and the other half of the toggle vocabulary: a row of
// alternatives is a ToggleButton, a single labelled setting is a Switch.
export {
  ToggleButton,
  type ToggleButtonProps,
  type ToggleButtonSize,
  type ToggleButtonTone,
} from "./ToggleButton";
export { Truncate } from "./Truncate";
export { Unit } from "./Unit";
// ── Units ───────────────────────────────────────────────────────────────────
// The contract declares what a field IS; these decide how to SHOW it. The wire
// is canonical SI and never pre-scaled, so every ladder lives here.
export {
  displaySymbol,
  type FormatQuantityOptions,
  type FormattedQuantity,
  formatQuantity,
  type KnownQuantityKind,
  kindOfUnit,
  type QuantityKind,
  type Rung,
  registerUnit,
  STANDARD_GRAVITY,
  speakQuantity,
  type UnitDefinition,
  wordForSymbol,
} from "./units";
export { type ElementSize, useElementSize } from "./useElementSize";
export {
  Value,
  type ValueProps,
  type ValueSize,
  type ValueTone,
} from "./Value";
export { VisuallyHidden } from "./VisuallyHidden";
export { UI_KIT_VERSION } from "./version";
export { WidgetHeader, type WidgetHeaderProps } from "./WidgetHeader";
