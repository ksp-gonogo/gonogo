// Types-only, emits no runtime code: but NOT removable. It pulls the
// `DefaultTheme` augmentation into the declaration build's program, which is
// built from this entry graph rather than tsconfig's `include`. Drop it and
// `pnpm build` fails on `theme.space` in Box/Stack. See the file's own header.
import "./styledComponentsTheme";

// ── Theme ────────────────────────────────────────────────────────────────────
// Re-exported wholesale from `@ksp-gonogo/theme`, an internal `private: true`
// package that is never published, the build inlines it into `dist` (JS and
// `.d.ts` alike), so this is the theme's only public surface. It must stay a
// devDependency so it can't leak into the published manifest. See
// `tsup.config.ts`.
//
// Token convention for everything in this package: `@ksp-gonogo/ui-kit/tokens.css`
// is the one way a host mounts the tokens, and it is a build-time copy of the
// theme's `tokens.css`, so it cannot drift from it.
//
// Deliberately the ONLY route. A second one for hosts that build their global
// styles in JS (a `GonogoTokens` styled-components sheet) means a hand-typed
// copy of the same values that nothing checks: the one that existed fell 39
// properties behind without anyone noticing. A consumer that can install this
// package can import a stylesheet.
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
  ActionMenu,
  type ActionMenuItem,
  type ActionMenuProps,
} from "./ActionMenu";
export {
  type AugmentSettingsContextValue,
  AugmentSettingsProvider,
  useAllAugmentSettings,
  useAugmentSettings,
} from "./AugmentSettings";
export {
  AugmentSettingsPanel,
  type AugmentSettingsPanelProps,
} from "./AugmentSettingsPanel";
export {
  AugmentSlot,
  useAugmentAvailable,
  useSlotBound,
  useWidgetSegmentBound,
} from "./AugmentSlot";
export {
  AutoEmptyState,
  type AutoEmptyStateProps,
} from "./AutoEmptyState";
// ── Augment seam ──────────────────────────────────────────────────────────────
// The augment registry + declaration-merge type surface (`SlotRegistry`,
// `SlotProps`, the segment seam, the setting types), the `<AugmentSlot>`
// composition point, and the ui-kit-owned domain-availability store its
// presence gate reads. Spine-free (sdk types only); the frame-batched evaluator
// stays in core. `@ksp-gonogo/core` re-exports every symbol below, so an
// importer may use either package and a `declare module "@ksp-gonogo/core"`
// augmentation of `SlotRegistry` still merges.
export * from "./augments";
export {
  Badge,
  type BadgeProps,
  type BadgeSize,
} from "./Badge";
// `Unit`'s interval twin: a quantity that arrived as a range stays one, because
// the width of a mean orbital element is the number that says whether the orbit
// is stable.
export { Band, type BandProps } from "./Band";
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
  ARM_TIMEOUT_MS,
  CommandButton,
  type CommandButtonHandle,
  type CommandButtonPhase,
  type CommandButtonProps,
  type CommandButtonSize,
  type CommandButtonState,
  type CommandButtonTone,
  type CommandGateLike,
  type CommandReplyLike,
  PENDING_BACKSTOP_MS,
  REFUSAL_TIMEOUT_MS,
  type UseCommandButtonOptions,
  useCommandButton,
} from "./CommandButton/CommandButton";
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
  type CommandLossEntry,
  type CommandLossLike,
  CommandLossList,
  type CommandLossListProps,
  commandLossSentence,
  type RailLoss,
} from "./CommandDelay/CommandLossList";
export {
  type CommandOutcomeItem,
  CommandOutcomeList,
  type CommandOutcomeListProps,
} from "./CommandDelay/CommandOutcomeList";
export {
  CommandRefusalList,
  type CommandRefusalListProps,
  type RailRefusal,
} from "./CommandDelay/CommandRefusalList";
export {
  ControlDelayStream,
  type ControlDelayStreamProps,
  type ControlStreamDatum,
  type ControlStreamSample,
} from "./CommandDelay/ControlDelayStream";
export {
  type CommandRefusalEntry,
  type CommandRefusalLike,
  commandGateSentence,
  commandRefusalSentence,
} from "./CommandDelay/commandRefusalSentence";
export {
  type CommandHandle,
  createDelayRailStore,
  DelayRailContext,
  DelayRailProvider,
  type DelayRailStore,
  useActiveHandles,
  useDelayRailStore,
} from "./CommandDelay/DelayRailContext";
export {
  InFlightList,
  type InFlightListDensity,
  type InFlightListItem,
  type InFlightListMode,
  type InFlightListProps,
  useCountdown,
} from "./CommandDelay/InFlightList";
export { PanelDelayRail } from "./CommandDelay/PanelDelayRail";
export {
  SignalDelayBadge,
  type SignalDelayBadgeProps,
} from "./CommandDelay/SignalDelayBadge";
export {
  type InFlightCommandLike,
  toInFlightListItems,
} from "./CommandDelay/toInFlightListItems";
export {
  type CommandFailures,
  useCommandFailures,
} from "./CommandDelay/useCommandFailures";
export { usePanelDelay } from "./CommandDelay/usePanelDelay";
export { ComposerBar, type ComposerBarProps } from "./ComposerBar";
export {
  ConsoleFrame,
  type ConsoleFrameProps,
  type ConsoleTone,
} from "./ConsoleFrame";
export { Countdown, type CountdownProps } from "./Countdown";
export { configEqual } from "./configEqual";
// ── Contribution seam ─────────────────────────────────────────────────────────
// The type surface (re-exported from the sdk, which declares it), the read hooks
// and per-widget store, AND the per-frame aggregation that writes into that store.
// Both halves are here: the aggregation needs spine values, and every one of
// those is on the sdk, which this package already imports. Only the
// REGISTRATION registry is elsewhere, on the sdk.
//
// `@ksp-gonogo/core` re-exports every symbol below, so an importer may use
// either package and a `declare module "@ksp-gonogo/core"` augmentation of
// `ContributionRegistry`/`ComponentSlotRegistry` still merges.
export * from "./contributions";
export {
  type ContributionSlotEntry,
  ContributionsPanelStore,
  useContributions,
  useContributionsBySlotId,
} from "./contributionsRead";
export { ContributionsProvider } from "./contributionsRuntime";
export {
  DataKeyPicker,
  type DataKeyPickerProps,
  type KeyOption,
} from "./DataKeyPicker";
export { DataLine, type DataLineProps } from "./DataLine";
export {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  type DataTableSection,
} from "./DataTable";
export {
  Dial,
  type DialProps,
  type DialTick,
  type DialZone,
} from "./Dial";
export { Disclosure, type DisclosureProps } from "./Disclosure";
export { DivergingBar, type DivergingBarProps } from "./DivergingBar";
export { Divider, type DividerProps } from "./Divider";
export {
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
  DomainAvailabilityProvider,
  type DomainAvailabilityStore,
  useDomainAvailabilityStore,
  useDomainAvailable,
} from "./domainAvailability";
// ── Leaf components ──────────────────────────────────────────────────────────
export {
  EmptyState,
  type EmptyStateLayout,
  type EmptyStateProps,
} from "./EmptyState";
export { Fill, type FillProps } from "./Fill";
export {
  FilterChip,
  type FilterChipProps,
} from "./FilterChip";
export {
  FilterList,
  type FilterListProps,
  type FilterRow,
} from "./FilterList";
export {
  FitLabelButton,
  type FitLabelButtonProps,
} from "./FitLabelButton";
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
export { fitBox } from "./fitBox";
// `formatDuration` is NOT here, and that is the point. It was exported as a
// narrow escape for a `title` or an `aria-label`, and eleven files took it as
// a general one: `<Unit>` was documented as the only unit renderer while a
// raw string ladder sat one import away. The escapes that remain are
// `writeQuantity` and `speakQuantity` below, which take a Value and so cannot
// be handed a bare number under the wrong ladder. The formatter itself now
// leaves this package only through `<Unit>`, `<Countdown>` and
// `<MissionDate>`, and `styleguide-unit-exclusive.test.ts` is the guard.
// The date NOTATION lever. `formatKspDate` itself stays internal: a caller
// reads `<MissionDate>`, and the choice between the two notations is the
// operator's, primed once per screen from the persisted setting.
export { realDatesWanted, setRealDatesPreferred } from "./formatKspDate";
// ── Formatters ───────────────────────────────────────────────────────────────
export { Gauge, type GaugeProps, type GaugeZone } from "./Gauge";
export {
  GraphNotice,
  type GraphNoticePlacement,
  type GraphNoticeProps,
} from "./GraphNotice";
export { Grid, type GridAlign, type GridProps } from "./Grid";
export {
  COL_WIDTH,
  GRID_MARGIN,
  gridToPixels,
  ROW_HEIGHT,
} from "./gridUnits";
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
  InfoIcon,
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
  SendIcon,
  SettingsIcon,
  StarIcon,
  StopIcon,
} from "./Icons";
export { Inline, type InlineProps } from "./Inline";
export { JogWheel, type JogWheelProps } from "./JogWheel";
export {
  type KspCalendar,
  kspCalendar,
  kspYearDays,
  STOCK_KERBIN_CALENDAR,
  setKspCalendar,
} from "./kspTime";
// ── Layout primitives ────────────────────────────────────────────────────────
export { LabeledInput, type LabeledInputProps } from "./LabeledInput";
export {
  LineGraph,
  type LineGraphProps,
  type LineGraphSeries,
  type LineGraphThreshold,
  type LineGraphThresholdStyle,
} from "./LineGraph";
export {
  AntiNormalIcon,
  AntiTargetIcon,
  BinormalIcon,
  FrenetNormalIcon,
  MARKER_ICONS,
  MARKER_IDS,
  ManeuverIcon,
  type MarkerIconProps,
  type MarkerId,
  NormalIcon,
  ParallelMinusIcon,
  ParallelPlusIcon,
  ProgradeIcon,
  RadialInIcon,
  RadialOutIcon,
  RelativeMinusIcon,
  RelativePlusIcon,
  RetrogradeIcon,
  TangentIcon,
  TargetIcon,
} from "./MarkerIcons";
export {
  Meter,
  type MeterProps,
  type MeterSize,
  MeterStack,
  type MeterTone,
} from "./Meter";
export { MissionDate, type MissionDateProps } from "./MissionDate";
export {
  MissionDateField,
  type MissionDateFieldProps,
  type MissionDateParts,
  partsOfUt,
  utOfParts,
} from "./MissionDateField";
export { ModalProvider, useModal } from "./Modal";
export {
  ModalChromeContext,
  type ModalChromeValue,
  type ModalSaveBarOptions,
  useModalChrome,
  useModalSaveBar,
} from "./ModalSaveBar";
export {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "./magnitude";
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
// `<Panel panelTitle="...">` in new code. See README.md's Panel section.
export {
  FRAMEWORK_AUGMENT_SEGMENTS,
  Panel,
  PanelBody,
  PanelContainer,
  PanelContextProvider,
  PanelFooter,
  PanelGlow,
  PanelHeader,
  type PanelProps,
  PanelProviders,
  PanelSidebar,
  type PanelSidebarSide,
  PanelSplit,
  type PanelSplitProps,
  PanelTitle,
  type PanelTitleProps,
  PanelToolbar,
  ScrollArea,
  WidgetSections,
} from "./Panel";
export { type BadgeEntry, PanelBadgesProvider } from "./PanelBadges";
export { ProgressBar, type ProgressBarProps } from "./ProgressBar";
export {
  ReadOnlyField,
  ReadOnlyFieldContent,
  type ReadOnlyFieldProps,
  type ReadOnlyFieldValue,
} from "./ReadOnlyField";
export {
  BigReadout,
  Readout,
  ReadoutCaption,
  type ReadoutTone,
  StatusPill,
} from "./Readout";
export { Row, RowName, type RowProps } from "./Row";
export { resourceColor } from "./resourceColor";
export { Section, type SectionProps, SectionTitle } from "./Section";
export {
  SelectableRow,
  type SelectableRowProps,
} from "./SelectableRow";
export { Spinner, type SpinnerProps } from "./Spinner";
export { type SpaceToken, Stack, type StackProps } from "./Stack";
export { Stat, type StatProps, StatStrip } from "./Stat";
export {
  StatContributions,
  type StatContributionsProps,
} from "./StatContributions";
export {
  StatusIndicator,
  type StatusIndicatorProps,
  type StatusTone,
} from "./StatusIndicator";
// The third member of the numeric-input vocabulary, beside `UnitInput` (a free
// quantity) and `JogWheel` (a quantity tuned by feel): one of a small closed
// set, where a value between two members is not a value at all.
export { Stepper, type StepperProps } from "./Stepper";
export {
  formatStreamStatus,
  StreamStatusBadge,
  type StreamStatusBadgeProps,
} from "./StreamStatusBadge";
export {
  SubjectHeading,
  type SubjectHeadingProps,
} from "./SubjectHeading";
export { Switch } from "./Switch";
export { STAT_TONE_COLOR, type StatTone } from "./statTone";
export {
  PanelStatusDot,
  type PanelStatusDotProps,
} from "./status/PanelStatusDot";
export {
  createPanelStatusStore,
  type PanelStatusStore,
  PanelStatusStoreProvider,
  type StatusBreakdownEntry,
  type StatusContribution,
  type StatusSummary,
  usePanelStatusStore,
} from "./status/PanelStatusStore";
// ── Status system (canonical severity vocabulary + panel status store) ────────
export {
  type Severity,
  severityFromBadgeEntryTone,
  severityFromStreamStatus,
  severityRank,
  worstSeverity,
} from "./status/severity";
export { severityDotColor } from "./status/severityDotColor";
export { useStatusBreakdown } from "./status/useStatusBreakdown";
export { useStatusContribution } from "./status/useStatusContribution";
export { useStatusSummary } from "./status/useStatusSummary";
// ── Store factory (generic off-tree store + per-panel context wrapper) ────────
export { createPanelStore, type PanelStore } from "./store/createPanelStore";
export { createStore, type Store } from "./store/createStore";
export {
  shouldExpandTabs,
  TABS_PANEL_MIN_WIDTH,
  type TabDescriptor,
  Tabs,
  type TabsProps,
} from "./Tabs";
export {
  Tape,
  type TapeMarker,
  type TapeProps,
  type TapeZone,
} from "./Tape";
export {
  Text,
  type TextProps,
  type TextSize,
  type TextTone,
  type TextWeight,
} from "./Text";
export { TextField, type TextFieldProps } from "./TextField";
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
export {
  type RateControl,
  type SlidableRange,
  UnitInput,
  type UnitInputProps,
} from "./UnitInput";
// ── Units ───────────────────────────────────────────────────────────────────
// The contract declares what a field IS; these decide how to SHOW it. The wire
// is canonical SI and never pre-scaled, so every ladder lives here.
// Only the extension point and the shapes it needs. Every formatter that used
// to live here is gone: `<Unit value={...} />` is the one way to show a
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
  type PanelAsideSize,
  PanelAsideSizeProvider,
  usePanelAsideSize,
} from "./usePanelAsideSize";
export { usePrefersReducedMotion } from "./usePrefersReducedMotion";
export {
  type RowFilter,
  type UseRowFilterOptions,
  useRowFilter,
} from "./useRowFilter";
export { useWidgetBadges } from "./useWidgetBadges";
export { VisuallyHidden } from "./VisuallyHidden";
export { UI_KIT_VERSION } from "./version";
export { WidgetHeader, type WidgetHeaderProps } from "./WidgetHeader";
export * from "./WidgetMetaContext";
export { WidgetMeters, type WidgetMetersProps } from "./WidgetMeters";
export {
  useWidgetScope,
  type WidgetScope,
  WidgetScopeProvider,
  type WidgetScopeRegistry,
} from "./WidgetScope";
export {
  type WidgetTopicDeclaration,
  widgetDeclaredTopics,
  widgetDrawnFields,
} from "./widgetDeclaredTopics";
