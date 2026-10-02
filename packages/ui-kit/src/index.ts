// Types-only but not removable: it pulls the `DefaultTheme` augmentation into the declaration build, which is built from this entry graph.
import "./styledComponentsTheme";

/** The one tone scale, from the sdk, so a kit consumer types its props without a second import. */
export type { AlertTone, Tone } from "@ksp-gonogo/sitrep-sdk";
/*
 * The theme is re-exported from the private `@ksp-gonogo/theme`, which the build
 * inlines into `dist`, so this is its only public surface. A host mounts the
 * tokens through `@ksp-gonogo/ui-kit/tokens.css` and nothing else; tokens are
 * read with no inline fallback, so a host that mounts none gets every padding
 * and gap at `0`.
 */
export {
  DefaultThemeProvider,
  defaultDarkTheme,
  type ThemeBorders,
  type ThemeColors,
  type ThemeTypography,
  type UiKitTheme,
} from "@ksp-gonogo/theme";
export {
  ActionMenu,
  type ActionMenuItem,
  type ActionMenuProps,
} from "./ActionMenu";
// Audio capture: the probe and state machine are exported beside the control, for a host with its own chrome.
export {
  AudioInputPicker,
  type AudioInputPickerProps,
} from "./AudioInputPicker";
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
  useSlotLabel,
  useWidgetSegmentBound,
} from "./AugmentSlot";
export {
  AutoEmptyState,
  type AutoEmptyStateProps,
} from "./AutoEmptyState";
export {
  type AnchoredPosition,
  type AnchorPoint,
  anchoredPosition,
} from "./anchoredPosition";
export {
  type AudioCaptureSupport,
  type AudioCaptureUnsupportedReason,
  audioCaptureSupport,
} from "./audioCaptureSupport";
// The augment registry and declaration-merge type surface, and the domain-availability store its presence gate reads.
export * from "./augments";
export {
  Badge,
  type BadgeProps,
  type BadgeSize,
} from "./Badge";
// `Unit`'s interval twin: a quantity that arrived as a range stays one.
export { Band, type BandProps, INTERVAL_DASH } from "./Band";
/*
 * `Block` is the arrangement of a record and `Card` is the same arrangement on a
 * sunken surface; their parts are one set of objects (`Card.Title ===
 * Block.Title`). Only the compounds are published, so no bare part freezes a
 * DOM structure as API.
 */
export { Block, type BlockProps, type BlockTitleRowProps } from "./Block";
export {
  Box,
  type BoxPad,
  type BoxProps,
  type BoxRadius,
  type BoxSurface,
} from "./Box";
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonTone,
  type ButtonVariant,
  IconButton,
  TextButton,
} from "./Button";
export { type BadgeFace, badgeFace } from "./badgeFace";
// How doubt is spoken, in one place, for surfaces outside this package too.
export { bandClaim } from "./bandClaim";
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
  type UseCommandButtonOptions,
  useCommandButton,
} from "./CommandButton/CommandButton";
export {
  InFlightFace,
  type InFlightFaceProps,
} from "./CommandButton/InFlightFace";
export {
  CommandDelay,
  type CommandDelayHandle,
  type CommandDelayProps,
} from "./CommandDelay/CommandDelay";
export {
  CommandGroup,
  type CommandGroupProps,
} from "./CommandDelay/CommandGroup";
export {
  CommandList,
  type CommandListKind,
  type CommandListProps,
} from "./CommandDelay/CommandList";
export {
  ControlDelayStream,
  type ControlDelayStreamProps,
  type ControlDelayStreamVariant,
  type ControlRibbonDatum,
  type ControlStreamDatum,
  type ControlStreamSample,
  ribbonBoundaryX,
  STREAM_MIN_DELAY_SECONDS,
} from "./CommandDelay/ControlDelayStream";
export {
  type CommandFailedEntry,
  type CommandFailedLike,
  commandFailedSentence,
  type RailFailed,
} from "./CommandDelay/commandFailedSentence";
export {
  type CommandFoundEntry,
  type CommandFoundLike,
  commandFoundSentence,
  type RailFound,
} from "./CommandDelay/commandFoundSentence";
export {
  type CommandLossEntry,
  type CommandLossLike,
  commandLossSentence,
  type RailLoss,
} from "./CommandDelay/commandLossSentence";
export {
  type CommandOutcomes,
  commandOutcomes,
} from "./CommandDelay/commandOutcomes";
export {
  type CommandRefusalEntry,
  type CommandRefusalLike,
  commandGateSentence,
  commandRefusalSentence,
  type RailRefusal,
} from "./CommandDelay/commandRefusalSentence";
export {
  type CommandUndeliveredEntry,
  type CommandUndeliveredLike,
  commandUndeliveredSentence,
  type RailUndelivered,
} from "./CommandDelay/commandUndeliveredSentence";
export {
  type CommandHandle,
  createDelayRailStore,
  DelayRailContext,
  DelayRailProvider,
  useActiveHandles,
  useDelayRailStore,
} from "./CommandDelay/DelayRailContext";
export {
  InFlightList,
  type InFlightListDensity,
  type InFlightListItem,
  type InFlightListMode,
  type InFlightListProps,
} from "./CommandDelay/InFlightList";
export {
  type RailContinuity,
  type RailDelivery,
  type RailDirection,
  type RailTags,
  railTagKey,
} from "./CommandDelay/railTags";
export {
  SignalDelayBadge,
  type SignalDelayBadgeProps,
} from "./CommandDelay/SignalDelayBadge";
export { toInFlightListItems } from "./CommandDelay/toInFlightListItems";
export { type RailEntry, useRailEntry } from "./CommandDelay/useRailEntry";
export {
  WAVE_HALF_H,
  WAVE_MID_Y,
  waveformPath,
} from "./CommandDelay/waveformPath";
export { ComposerBar, type ComposerBarProps } from "./ComposerBar";
// The only door to the console's parts; `ComposerBar` stays public because what goes on the row is the widget's.
export { Console, type ConsoleProps, type ConsoleTone } from "./Console";
export {
  ContainerBreak,
  type ContainerBreakProps,
} from "./ContainerBreak";
export { Countdown, type CountdownProps } from "./Countdown";
export { configEqual } from "./configEqual";
// The contribution type surface, read hooks, per-widget store and per-frame aggregation; registration lives on the sdk.
export * from "./contributions";
export {
  type ContributionSlotEntry,
  ContributionsPanelStore,
  FRAMEWORK_CONTRIBUTION_SEGMENTS,
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
} from "./domainAvailability";
export {
  EmptyState,
  type EmptyStateLayout,
  type EmptyStateProps,
} from "./EmptyState";
export {
  ExpandableText,
  type ExpandableTextProps,
} from "./ExpandableText";
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
export { Floating, type FloatingProps } from "./Floating";
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
export type { FillQuantity } from "./fillQuantity";
// `formatDuration` is deliberately not exported: durations leave this package only through `<Unit>`, `<Countdown>` and `<MissionDate>`.
export { Gauge, type GaugeProps, type GaugeZone } from "./Gauge";
export {
  GraphNotice,
  type GraphNoticePlacement,
  type GraphNoticeProps,
  type GraphNoticeSpace,
  placeGraphNotice,
} from "./GraphNotice";
export { Grid, type GridAlign, type GridProps } from "./Grid";
export {
  COL_WIDTH,
  GRID_MARGIN,
  gridToPixels,
  ROW_HEIGHT,
} from "./gridUnits";
export { HeldBadge, type HeldBadgeProps } from "./HeldBadge";
export { HeldFigure, type HeldFigureProps } from "./HeldMark";
export { HoverCard, type HoverCardProps } from "./HoverCard";
export {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BellIcon,
  BroadcastIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
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
  HalfHeightIcon,
  HalfWidthIcon,
  HeartIcon,
  HistoryIcon,
  HomeIcon,
  type IconProps,
  InfoIcon,
  JoystickIcon,
  LayersIcon,
  LockIcon,
  MicroscopeIcon,
  MutedIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  PushUpIcon,
  RecallIcon,
  SatelliteIcon,
  SendIcon,
  SettingsIcon,
  SpeakerIcon,
  StarIcon,
  StopIcon,
} from "./Icons";
export { Inline, type InlineProps } from "./Inline";
// A reading's currency in a form an SVG instrument can draw, matching `<Unit>`'s mark and wording.
export { InstrumentHeldMark, sayHeld } from "./instrumentCurrency";
export {
  JogWheel,
  type JogWheelProps,
} from "./JogWheel";
export {
  type KspCalendar,
  kspCalendar,
  kspYearDays,
  STOCK_KERBIN_CALENDAR,
  setKspCalendar,
} from "./kspTime";
export { LevelBars, type LevelBarsProps } from "./LevelBars";
export {
  LineGraph,
  type LineGraphProps,
  type LineGraphSeries,
  type LineGraphThreshold,
  type LineGraphThresholdStyle,
} from "./LineGraph";
export { LiveRegion, type LiveRegionProps } from "./LiveRegion";
export { LockMark, type LockMarkProps } from "./LockMark";
export {
  LockScope,
  type LockScopeProps,
  type LockSummary,
} from "./LockScope";
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
  type MeterLayout,
  type MeterProps,
  MeterRowGroup,
  MeterStack,
} from "./Meter";
export {
  MissionDate,
  type MissionDateProps,
  type TimeContext,
} from "./MissionDate";
export {
  MissionDateField,
  type MissionDateFieldProps,
  type MissionDateParts,
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
  ModelledAlongside,
  type ModelledFigureAlongsideProps,
  type ModelledQuantityAlongsideProps,
  ReckonedUnit,
} from "./ModelledAlongside";
export {
  asQuantityish,
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "./magnitude";
export { Notice, type NoticeProps } from "./Notice";
export { NULL_DISPLAY, NullValue } from "./NullValue";
/*
 * `Panel` is the only door to its parts (`Panel.Context`, `.Delay`,
 * `.Container`, `.Header`, `.Toolbar`, `.Footer`, `.Title`, `.Glow`, `.Body`,
 * `.Section`, `.Sidebar`), so a widget needing a variant hand-composes from
 * there.
 */
export {
  FRAMEWORK_AUGMENT_SEGMENTS,
  Panel,
  type PanelBadge,
  type PanelInactiveReason,
  type PanelProps,
  type PanelSidebarSide,
  type PanelSplitProps,
  type PanelTitleProps,
  ScrollArea,
  WidgetSections,
} from "./Panel";
export { type BadgeEntry, PanelBadgesProvider } from "./PanelBadges";
export {
  ProgressBar,
  type ProgressBarPercentProps,
  type ProgressBarProps,
  type ProgressBarQuantityProps,
} from "./ProgressBar";
export {
  ReadFrameControl,
  type ReadFrameControlProps,
  type ReadFrameOption,
} from "./ReadFrameControl";
export {
  ReadOnlyField,
  type ReadOnlyFieldProps,
  type ReadOnlyFieldValue,
} from "./ReadOnlyField";
export {
  BigReadout,
  Readout,
  ReadoutCaption,
} from "./Readout";
export { Row, RowName, type RowProps } from "./Row";
export {
  modelledBeyondReceived,
  type Resolved,
  resolveCurrency,
} from "./readingCurrency";
export { reckoningBasisPhrase } from "./reckoningBasisPhrase";
export { resourceColor } from "./resourceColor";
export { SearchBox, type SearchBoxProps } from "./SearchBox";
export { Section, type SectionProps, SectionTitle } from "./Section";
export {
  SelectableRow,
  type SelectableRowProps,
} from "./SelectableRow";
export { Slider, type SliderProps } from "./Slider";
export { Spinner, type SpinnerProps } from "./Spinner";
export { Stack, type StackProps } from "./Stack";
export { Stat, type StatProps, StatStrip } from "./Stat";
export {
  StatContributions,
  type StatContributionsProps,
} from "./StatContributions";
export {
  StatusIndicator,
  type StatusIndicatorProps,
} from "./StatusIndicator";
// Numeric input over a small closed set, beside `UnitInput` (a free quantity) and `JogWheel` (tuned by feel).
export { Stepper, type StepperProps } from "./Stepper";
export {
  StreamStatusBadge,
  type StreamStatusBadgeProps,
} from "./StreamStatusBadge";
export {
  SubjectHeading,
  type SubjectHeadingProps,
} from "./SubjectHeading";
export { Switch, type SwitchProps } from "./Switch";
export type { GapToken, InsetToken } from "./scales";
export {
  type DrawnPrecision,
  placedOnScale,
  standsApart,
  writtenAs,
  writtenQuantity,
} from "./standsApart";
export type { StaticElement } from "./staticElement";
export {
  type PanelStatusStore,
  PanelStatusStoreProvider,
  type StatusBreakdownEntry,
  type StatusContribution,
  type StatusSummary,
  usePanelStatusStore,
} from "./status/PanelStatusStore";
export {
  type Severity,
  severityFromStreamStatus,
  worstSeverity,
} from "./status/severity";
export { formatStreamStatus, heldWord } from "./status/streamStatusWord";
export { useStatusBreakdown } from "./status/useStatusBreakdown";
export { useStatusContribution } from "./status/useStatusContribution";
export { useStatusSummary } from "./status/useStatusSummary";
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
  FAINT_TEXT_STYLE,
  faintText,
  Text,
  type TextLevel,
  type TextProps,
  type TextSize,
  type TextWeight,
} from "./Text";
export { TextField, type TextFieldProps } from "./TextField";
export {
  showsTiny,
  smallestBodyTile,
  TinyEssentials,
  type TinyEssentialsProps,
  WidgetBody,
} from "./TinyEssentials";
// A row of alternatives is a ToggleButton; a single labelled setting is a Switch.
export {
  ToggleButton,
  type ToggleButtonProps,
  type ToggleButtonSize,
  type ToggleButtonTone,
} from "./ToggleButton";
export {
  Tooltip,
  type TooltipAnchorProps,
  type TooltipProps,
  type UseTooltipResult,
  useTooltip,
} from "./Tooltip";
export { Truncate } from "./Truncate";
export {
  TONE_LABEL,
  TONE_MARK,
  TONE_ON_STATUS,
  TONE_STATUS,
  TONE_TEXT,
  toneEdge,
} from "./tone";
// `UnitValue` is the widened prop: a quantity, or a whole `Reading` of one.
export { Unit, type UnitProps, type UnitValue } from "./Unit";
export {
  type RateControl,
  type SlidableRange,
  UnitInput,
  type UnitInputProps,
} from "./UnitInput";
// The group half of `<Unit>`: quantities inside one scope settle a single format per kind.
export {
  type SharedFormat,
  type UnitGroupPins,
  type UnitPins,
  type UnitPinsByGroup,
  UnitSharedFormat,
  type UnitSharedFormatMixedProps,
  type UnitSharedFormatProps,
} from "./UnitSharedFormat";
/*
 * The contract declares what a field is; these decide how to show it. The wire
 * is canonical SI and never pre-scaled, so every ladder lives here. A unit is
 * declared and registered through the SDK, and `<Unit value={...} />` is the
 * one way to show a quantity.
 */
export {
  type FormatsFor,
  // `FormatsFor` asked of a kind, for a pin addressed to a whole group.
  type FormatsForKind,
  type KindOfGroup,
  type KnownQuantityKind,
  type LadderName,
  // The `as` twin of `FormatsFor`: the same kind plus presentation-only units such as `°C`.
  type PresentableAs,
  type PresentableAsKind,
  type QuantityKind,
  // A scale for an axis or moving-scale instrument: one rung, every mark printed against it, the symbol handed back apart.
  type QuantityScale,
  quantityScale,
  type Rung,
  STANDARD_GRAVITY,
  // The locale every quantity is written in; one call at boot changes every readout.
  setQuantityLocale,
  // String formatters for where a node cannot go: `speakQuantity` for an accessible name, `writeQuantity` for measured text.
  speakQuantity,
  // What a shared-format pin may be addressed to: a ladder, whose units settle one rung together, or a unit on no ladder, which groups alone.
  type UnitGroupKey,
  writeQuantity,
} from "./units";
export {
  type AudioInputControls,
  type AudioInputDevice,
  type AudioInputFailure,
  type AudioInputState,
  type AudioInputStatus,
  describeAudioInput,
  type UseAudioInputOptions,
  useAudioInput,
} from "./useAudioInput";
export { type ElementSize, useElementSize } from "./useElementSize";
export {
  type PanelAsideSize,
  usePanelAsideSize,
} from "./usePanelAsideSize";
export { usePrefersReducedMotion } from "./usePrefersReducedMotion";
export {
  FilterRegion,
  type FilterRegionProps,
  type RowFilter,
  type UseRowFilterOptions,
  useRowFilter,
} from "./useRowFilter";
export { useWidgetBadges } from "./useWidgetBadges";
export { VisuallyHidden } from "./VisuallyHidden";
export { UI_KIT_VERSION } from "./version";
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
export * from "./widgetSize";
