import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpToLine,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  Computer,
  CornerDownLeft,
  Database,
  FileText,
  Heart,
  History,
  Home,
  Info,
  Joystick,
  Layers,
  Lock,
  type LucideProps,
  Maximize,
  Microscope,
  Minimize,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RectangleHorizontal,
  RectangleVertical,
  Rows2,
  Satellite,
  Settings,
  Square,
  Star,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { forwardRef } from "react";

/**
 * Props for every icon in the kit: the lucide-react SVG props plus `label`.
 * Useful for sizing, colouring and naming an icon so the operator can tell what
 * a control does at a glance. Taken by every icon in the kit, such as
 * {@link PlusIcon}.
 *
 * `size` defaults to the standalone icon size token, which grows a step on a
 * coarse pointer; pass a number (pixels) or any CSS length to override it.
 * `strokeWidth` defaults to 1.8 (2.4 on {@link PlusIcon}). `color` sets the
 * stroke and defaults to `currentColor`, so an icon takes its text colour;
 * `fill` fills the shape. Any other SVG attribute passes through, and the ref
 * reaches the `svg` element.
 *
 * @category Icons
 * @categoryDescription Icons
 * The icon set: each icon takes its text colour and the control size unless
 * told otherwise, and is hidden from assistive technology unless it is given a
 * label.
 */
export interface IconProps extends LucideProps {
  /**
   * The icon's accessible name. With one, the icon renders as `role="img"`
   * named by it; without one it is decorative and hidden from assistive
   * technology, so the control it sits in must carry the name.
   */
  label?: string;
}

/**
 * A `var()` resolves inside the SVG `width`/`height` presentation attribute
 * lucide writes `size` out as, so the size token picks up the coarse-pointer
 * step a bare number cannot. The default is `control`, the glyph inside a
 * control the operator presses; a glyph that is its own control (a Fab) is
 * sized by that control.
 */
const ICON_DEFAULTS: LucideProps = {
  size: "var(--icon-size-control)",
  strokeWidth: 1.8,
  "aria-hidden": true,
};

function makeIcon(
  Component: React.ComponentType<LucideProps>,
  extraDefaults?: LucideProps,
) {
  const Wrapped = forwardRef<SVGSVGElement, IconProps>(
    ({ label, ...props }, ref) => {
      const naming = label
        ? { role: "img", "aria-label": label, "aria-hidden": false }
        : {};
      return (
        <Component
          {...ICON_DEFAULTS}
          {...extraDefaults}
          {...naming}
          {...props}
          ref={ref}
        />
      );
    },
  );
  Wrapped.displayName = Component.displayName ?? Component.name;
  return Wrapped;
}

/**
 * A joystick on a base. Useful for marking the controls that map a game
 * controller or serial device to dashboard actions.
 *
 * @category Icons
 */
export const JoystickIcon = makeIcon(Joystick);
/**
 * A clock face with a counter-clockwise arrow. Useful for marking past flights
 * or earlier messages. Used by the commcast message rows.
 *
 * @category Icons
 */
export const HistoryIcon = makeIcon(History);
/**
 * A house. Useful for marking the operator's home command centre. Used by the
 * vantage control. It carries no name of its own, so give it a `label` or name
 * the control it sits in.
 *
 * @category Icons
 */
export const HomeIcon = makeIcon(Home);
/**
 * A lowercase "i" in a circle. Useful for marking a control that opens further
 * detail for the operator. Used by the kerbal info popover and the commcast
 * message rows.
 *
 * @category Icons
 */
export const InfoIcon = makeIcon(Info);
/**
 * A closed padlock. Useful for marking something this save has not unlocked
 * yet. Used by {@link LockMark}.
 *
 * @category Icons
 */
export const LockIcon = makeIcon(Lock);
/**
 * A point with radio waves spreading on either side. Useful for showing the
 * operator a broadcast or a live connection. Used by the radio push-to-talk and
 * indicator controls and by the station link and connection buttons.
 *
 * @category Icons
 */
export const BroadcastIcon = makeIcon(Radio);
/**
 * A speaker with sound waves. Useful for showing the operator that sound is on.
 * Used by the radio mute control. {@link MutedIcon} is its muted pair.
 *
 * @category Icons
 */
export const SpeakerIcon = makeIcon(Volume2);
/**
 * A speaker crossed out. Useful for showing the operator that sound is muted.
 * Used by the radio mute control and the radio indicator. {@link SpeakerIcon}
 * is its audible pair.
 *
 * @category Icons
 */
export const MutedIcon = makeIcon(VolumeX);
/**
 * A bell. Useful for marking an alarm or a notification. Used by the warp
 * control's next-alarm row, the alarms button and the contract objectives list.
 *
 * @category Icons
 */
export const BellIcon = makeIcon(Bell);
/**
 * Stacked layers. Useful for marking the mission profiles the operator can
 * switch between. Used by the mission profiles button.
 *
 * @category Icons
 */
export const LayersIcon = makeIcon(Layers);
/**
 * A cog. Useful for opening settings. Used by the settings button, the commcast
 * inbox and the dashboard widget gear menu.
 *
 * @category Icons
 */
export const SettingsIcon = makeIcon(Settings);
/**
 * A satellite with solar panels. Useful for marking a satellite in a list the
 * operator reads.
 *
 * @category Icons
 */
export const SatelliteIcon = makeIcon(Satellite);
/**
 * Four corners pointing outward. Useful for the control that puts the dashboard
 * into fullscreen. Used by the fullscreen button.
 *
 * @category Icons
 */
export const FullscreenEnterIcon = makeIcon(Maximize);
/**
 * Four corners pointing inward. Useful for the control that leaves fullscreen.
 * Used by the fullscreen button.
 *
 * @category Icons
 */
export const FullscreenExitIcon = makeIcon(Minimize);
/**
 * A database cylinder. Useful for marking stored data.
 *
 * @category Icons
 */
export const DatabaseIcon = makeIcon(Database);
/**
 * A desktop computer. Useful for marking a device or a processor.
 *
 * @category Icons
 */
export const ComputerIcon = makeIcon(Computer);
/**
 * A page of text. Useful for marking diagnostics and logs.
 *
 * @category Icons
 */
export const DiagnosticsIcon = makeIcon(FileText);
/**
 * A plus sign, drawn with a heavier 2.4 stroke than the other icons. Useful for
 * the control that adds an item. Used by the commcast inbox and thread views.
 *
 * @category Icons
 */
export const PlusIcon = makeIcon(Plus, { strokeWidth: 2.4 });

/**
 * An X. Useful for the control that closes or dismisses something. Used by the
 * maneuver planner's node rows and armed triggers list, the research and development detail
 * panel and the pushed dashboard overlay.
 *
 * @category Icons
 */
export const CloseIcon = makeIcon(X);
/**
 * A pencil. Useful for the control that edits an item. Used by the maneuver
 * planner's node rows.
 *
 * @category Icons
 */
export const PencilIcon = makeIcon(Pencil);
/**
 * A check mark. Useful for confirming or marking something done. Used by the
 * space centre upgrade button and the research and development node facts.
 *
 * @category Icons
 */
export const CheckIcon = makeIcon(Check);
/**
 * A five-pointed star. Useful for showing the operator a reputation amount.
 * Used by {@link Unit} as the reputation symbol.
 *
 * @category Icons
 */
export const StarIcon = makeIcon(Star);
/**
 * A heart outline; pass `fill="currentColor"` for a solid heart. Useful for
 * marking a favoured item.
 *
 * @category Icons
 */
export const HeartIcon = makeIcon(Heart);
/**
 * A microscope. Useful for showing the operator a science amount. Used by
 * {@link Unit} as the science symbol.
 *
 * @category Icons
 */
export const MicroscopeIcon = makeIcon(Microscope);
/**
 * A right-pointing triangle. Useful for the control that starts or resumes
 * something. Used by the warp control and the alarm banner.
 *
 * @category Icons
 */
export const PlayIcon = makeIcon(Play);
/**
 * Two vertical bars. Useful for the control that pauses something. Used by the
 * warp control.
 *
 * @category Icons
 */
export const PauseIcon = makeIcon(Pause);
/**
 * A square. Useful for the control that stops something. Used by the alarm
 * banner.
 *
 * @category Icons
 */
export const StopIcon = makeIcon(Square);
/**
 * An upward chevron. Useful for the control that collapses a section or steps
 * an item up. Used by the space centre upgrade button, the mobile dashboard and
 * the note rows.
 *
 * @category Icons
 */
export const ChevronUpIcon = makeIcon(ChevronUp);
/**
 * A downward chevron. Useful for the control that expands a section or steps an
 * item down. Used by the vantage control, the mobile dashboard and the note
 * rows.
 *
 * @category Icons
 */
export const ChevronDownIcon = makeIcon(ChevronDown);
/**
 * A left-pointing chevron. Useful for the control that goes back or to the
 * previous item.
 *
 * @category Icons
 */
export const ChevronLeftIcon = makeIcon(ChevronLeft);
/**
 * A right-pointing chevron. Useful for the control that goes forward or to the
 * next item. Used by {@link Disclosure}.
 *
 * @category Icons
 */
export const ChevronRightIcon = makeIcon(ChevronRight);
/**
 * A left-pointing arrow. Useful for the control that returns to the previous
 * view. Used by the commcast back button.
 *
 * @category Icons
 */
export const ArrowLeftIcon = makeIcon(ArrowLeft);
/**
 * An upward arrow. Useful for marking a rise or an upward direction.
 *
 * @category Icons
 */
export const ArrowUpIcon = makeIcon(ArrowUp);
/**
 * A right-pointing arrow. Useful for marking a step from one state to the next.
 * Used by the maneuver planner's armed triggers list and the alarm banner.
 *
 * @category Icons
 */
export const ArrowRightIcon = makeIcon(ArrowRight);
/**
 * A downward arrow. Useful for marking a fall or a downward direction.
 *
 * @category Icons
 */
export const ArrowDownIcon = makeIcon(ArrowDown);
/**
 * An upward arrow meeting a line. Useful for the control that pushes a widget
 * up to another screen. Used by the dashboard widget controls.
 *
 * @category Icons
 */
export const PushUpIcon = makeIcon(ArrowUpToLine);
/**
 * A curved arrow turning back. Useful for the control that recalls a widget
 * that was pushed away, or undoes the push. Used by the dashboard widget
 * controls.
 *
 * @category Icons
 */
export const RecallIcon = makeIcon(Undo2);
/**
 * A rectangle split into two columns. Useful for the control that gives a tile
 * half the width. Used by the mobile dashboard's tile size controls.
 *
 * @category Icons
 */
export const HalfWidthIcon = makeIcon(Columns2);
/**
 * A wide rectangle. Useful for the control that gives a tile the full width.
 * Used by the mobile dashboard's tile size controls.
 *
 * @category Icons
 */
export const FullWidthIcon = makeIcon(RectangleHorizontal);
/**
 * A rectangle split into two rows. Useful for the control that gives a tile
 * half the height. Used by the mobile dashboard's tile size controls.
 *
 * @category Icons
 */
export const HalfHeightIcon = makeIcon(Rows2);
/**
 * A tall rectangle. Useful for the control that gives a tile the full height.
 * Used by the mobile dashboard's tile size controls.
 *
 * @category Icons
 */
export const FullHeightIcon = makeIcon(RectangleVertical);
/**
 * A return arrow (the symbol on the Enter key). Useful for the control that
 * commits what the operator composed locally, such as a console line or a
 * staged command. Used by {@link ComposerBar}. Use a different icon for
 * anything that fires on its own.
 *
 * Unnamed, it is decorative, so name the action on the control (for example
 * `sendLabel` on {@link ComposerBar}).
 *
 * @category Icons
 */
export const SendIcon = makeIcon(CornerDownLeft);
