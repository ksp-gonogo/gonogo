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
  type CameraSetpoint,
  type CameraSetpointBounds,
  CameraSetpointInput,
  type CameraSetpointInputProps,
} from "./CommandDelay/CameraSetpointInput";
export {
  CommandDelay,
  type CommandDelayHandle,
  type CommandDelayProps,
  type CommandOutputToken,
} from "./CommandDelay/CommandDelay";
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
export {
  type InFlightCommandLike,
  toInFlightListItems,
} from "./CommandDelay/toInFlightListItems";
export { Countdown, type CountdownProps } from "./Countdown";
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
export { Disclosure, type DisclosureProps } from "./Disclosure";
export { Divider, type DividerProps } from "./Divider";
// ── Leaf components ──────────────────────────────────────────────────────────
export {
  EmptyState,
  type EmptyStateLayout,
  type EmptyStateProps,
} from "./EmptyState";
export { Fill, type FillProps } from "./Fill";
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
// The third, and the last: a CLOCK as a string. `<Countdown>` is the node
// form and is what a call site should reach for; this exists because four
// separate files had each hand-rolled the same s/m/h ladder to build a
// string for a `title`, an `aria-label`, or a template literal, and four
// copies of a ladder is precisely what this package exists to prevent. It is
// NOT a general escape from `<Countdown>`: if a node fits, use one.
export { type FormatDurationOptions, formatDuration } from "./formatDuration";
// ── Formatters ───────────────────────────────────────────────────────────────
export {
  GraphNotice,
  type GraphNoticePlacement,
  type GraphNoticeProps,
} from "./GraphNotice";
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
  ComputerIcon,
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
  type KspCalendar,
  kspCalendar,
  kspYearDays,
  STOCK_KERBIN_CALENDAR,
  setKspCalendar,
} from "./kspTime";
export { MissionDate, type MissionDateProps } from "./MissionDate";
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
export {
  BigReadout,
  Readout,
  ReadoutCaption,
  type ReadoutTone,
  StatusPill,
} from "./Readout";
export { Row, RowName, type RowProps } from "./Row";
export { Section, type SectionProps, SectionTitle } from "./Section";
export {
  SelectableRow,
  type SelectableRowProps,
} from "./SelectableRow";
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
// Only the extension point and the shapes it needs. Every formatter that used
// to live here is gone: `<Unit value={…} />` is the one way to show a
// quantity, and a second way is how eleven widgets each grew their own ladder.
export {
  type FormatsFor,
  type KnownQuantityKind,
  type QuantityKind,
  type Rung,
  registerUnit,
  STANDARD_GRAVITY,
  // The locale every quantity is written in. One call at app boot changes
  // every readout at once, which is what having one formatter buys.
  setQuantityLocale,
  // The only string formatters this package exports, for the places a node
  // cannot go: `speakQuantity` for an accessible name, `writeQuantity` for
  // visible text that is measured (an SVG label, a canvas). See their doc
  // comments; everywhere else renders `<Unit>`.
  speakQuantity,
  type UnitDefinition,
  writeQuantity,
} from "./units";
export { type ElementSize, useElementSize } from "./useElementSize";
export {
  Value,
  type ValueProps,
  type ValueSize,
  type ValueTone,
  type ValueWeight,
} from "./Value";
export { VisuallyHidden } from "./VisuallyHidden";
export { UI_KIT_VERSION } from "./version";
export { WidgetHeader, type WidgetHeaderProps } from "./WidgetHeader";
