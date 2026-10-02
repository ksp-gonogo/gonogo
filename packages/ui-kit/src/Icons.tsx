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
 *
 * `size` defaults to the standalone icon size token, which grows a step on a
 * coarse pointer; pass a number (pixels) or any CSS length to override it.
 * `strokeWidth` defaults to 1.8 (2.4 on {@link PlusIcon}). `color` sets the
 * stroke and defaults to `currentColor`, so an icon takes its text colour;
 * `fill` fills the shape. Any other SVG attribute passes through, and the ref
 * reaches the `svg` element.
 *
 * @category Icons
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
 * A joystick on a base, used for serial and controller input.
 *
 * @category Icons
 */
export const JoystickIcon = makeIcon(Joystick);
/**
 * A clock face with a counter-clockwise arrow, for history or past flights.
 *
 * @category Icons
 */
export const HistoryIcon = makeIcon(History);
/**
 * A house, marking the home command centre. It carries no name of its own, so give it a `label` or name the control it sits in.
 *
 * @category Icons
 */
export const HomeIcon = makeIcon(Home);
/**
 * A lowercase "i" in a circle, for information.
 *
 * @category Icons
 */
export const InfoIcon = makeIcon(Info);
/**
 * A closed padlock, marking something this save has not unlocked yet.
 *
 * @category Icons
 */
export const LockIcon = makeIcon(Lock);
/**
 * A point with radio waves spreading on either side, for broadcasting or a live link.
 *
 * @category Icons
 */
export const BroadcastIcon = makeIcon(Radio);
/**
 * A speaker with sound waves, for audible. {@link MutedIcon} is its muted pair.
 *
 * @category Icons
 */
export const SpeakerIcon = makeIcon(Volume2);
/**
 * A speaker crossed out, for muted. {@link SpeakerIcon} is its audible pair.
 *
 * @category Icons
 */
export const MutedIcon = makeIcon(VolumeX);
/**
 * A bell, for notifications or alerts.
 *
 * @category Icons
 */
export const BellIcon = makeIcon(Bell);
/**
 * Stacked layers, for profiles, presets or layered views.
 *
 * @category Icons
 */
export const LayersIcon = makeIcon(Layers);
/**
 * A cog, for settings.
 *
 * @category Icons
 */
export const SettingsIcon = makeIcon(Settings);
/**
 * A satellite with solar panels.
 *
 * @category Icons
 */
export const SatelliteIcon = makeIcon(Satellite);
/**
 * Four corners pointing outward, for entering fullscreen.
 *
 * @category Icons
 */
export const FullscreenEnterIcon = makeIcon(Maximize);
/**
 * Four corners pointing inward, for leaving fullscreen.
 *
 * @category Icons
 */
export const FullscreenExitIcon = makeIcon(Minimize);
/**
 * A database cylinder, for stored data.
 *
 * @category Icons
 */
export const DatabaseIcon = makeIcon(Database);
/**
 * A desktop computer, for a device or processor.
 *
 * @category Icons
 */
export const ComputerIcon = makeIcon(Computer);
/**
 * A page of text, for diagnostics and logs.
 *
 * @category Icons
 */
export const DiagnosticsIcon = makeIcon(FileText);
/**
 * A plus sign, for add. Drawn with a heavier 2.4 stroke than the other icons.
 *
 * @category Icons
 */
export const PlusIcon = makeIcon(Plus, { strokeWidth: 2.4 });

/**
 * An X, for close or dismiss.
 *
 * @category Icons
 */
export const CloseIcon = makeIcon(X);
/**
 * A pencil, for edit.
 *
 * @category Icons
 */
export const PencilIcon = makeIcon(Pencil);
/**
 * A check mark, for confirm or done.
 *
 * @category Icons
 */
export const CheckIcon = makeIcon(Check);
/**
 * A five-pointed star; {@link Unit} draws it as the reputation symbol.
 *
 * @category Icons
 */
export const StarIcon = makeIcon(Star);
/**
 * A heart outline; pass `fill="currentColor"` for a solid heart.
 *
 * @category Icons
 */
export const HeartIcon = makeIcon(Heart);
/**
 * A microscope; {@link Unit} draws it as the science symbol.
 *
 * @category Icons
 */
export const MicroscopeIcon = makeIcon(Microscope);
/**
 * A right-pointing triangle, for play or run.
 *
 * @category Icons
 */
export const PlayIcon = makeIcon(Play);
/**
 * Two vertical bars, for pause.
 *
 * @category Icons
 */
export const PauseIcon = makeIcon(Pause);
/**
 * A square, for stop.
 *
 * @category Icons
 */
export const StopIcon = makeIcon(Square);
/**
 * An upward chevron, for collapse or step up.
 *
 * @category Icons
 */
export const ChevronUpIcon = makeIcon(ChevronUp);
/**
 * A downward chevron, for expand or step down.
 *
 * @category Icons
 */
export const ChevronDownIcon = makeIcon(ChevronDown);
/**
 * A left-pointing chevron, for back or previous.
 *
 * @category Icons
 */
export const ChevronLeftIcon = makeIcon(ChevronLeft);
/**
 * A right-pointing chevron, for forward or next.
 *
 * @category Icons
 */
export const ChevronRightIcon = makeIcon(ChevronRight);
/**
 * A left-pointing arrow.
 *
 * @category Icons
 */
export const ArrowLeftIcon = makeIcon(ArrowLeft);
/**
 * An upward arrow.
 *
 * @category Icons
 */
export const ArrowUpIcon = makeIcon(ArrowUp);
/**
 * A right-pointing arrow.
 *
 * @category Icons
 */
export const ArrowRightIcon = makeIcon(ArrowRight);
/**
 * A downward arrow.
 *
 * @category Icons
 */
export const ArrowDownIcon = makeIcon(ArrowDown);
/**
 * An upward arrow meeting a line, for pushing something up to another screen.
 *
 * @category Icons
 */
export const PushUpIcon = makeIcon(ArrowUpToLine);
/**
 * A curved arrow turning back, for recalling something that was pushed away or undoing it.
 *
 * @category Icons
 */
export const RecallIcon = makeIcon(Undo2);
/**
 * A rectangle split into two columns, for a half-width layout.
 *
 * @category Icons
 */
export const HalfWidthIcon = makeIcon(Columns2);
/**
 * A wide rectangle, for a full-width layout.
 *
 * @category Icons
 */
export const FullWidthIcon = makeIcon(RectangleHorizontal);
/**
 * A rectangle split into two rows, for a half-height layout.
 *
 * @category Icons
 */
export const HalfHeightIcon = makeIcon(Rows2);
/**
 * A tall rectangle, for a full-height layout.
 *
 * @category Icons
 */
export const FullHeightIcon = makeIcon(RectangleVertical);
/**
 * A return arrow (the symbol on the Enter key), for committing what the
 * operator composed locally, such as a console line or a staged command. Use
 * a different icon for anything that fires on its own.
 *
 * Unnamed, it is decorative, so name the action on the control (for example
 * {@link ComposerBar}'s `sendLabel`).
 *
 * @category Icons
 */
export const SendIcon = makeIcon(CornerDownLeft);
