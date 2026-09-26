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

export type IconProps = LucideProps;

/**
 * A `var()` resolves inside the SVG `width`/`height` presentation attribute
 * lucide writes `size` out as, so the size token picks up the coarse-pointer
 * step a bare number cannot. The default `standalone` is calibrated for Fabs.
 */
const ICON_DEFAULTS: LucideProps = {
  size: "var(--icon-size-standalone)",
  strokeWidth: 1.8,
  "aria-hidden": true,
};

function makeIcon(
  Component: React.ComponentType<LucideProps>,
  extraDefaults?: LucideProps,
) {
  const Wrapped = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    <Component {...ICON_DEFAULTS} {...extraDefaults} {...props} ref={ref} />
  ));
  Wrapped.displayName = Component.displayName ?? Component.name;
  return Wrapped;
}

export const JoystickIcon = makeIcon(Joystick);
export const HistoryIcon = makeIcon(History);
/** Marks a roster entry as the home command centre. Decorative: pair with an accessible name from the caller, this glyph carries none of its own. */
export const HomeIcon = makeIcon(Home);
export const InfoIcon = makeIcon(Info);
export const BroadcastIcon = makeIcon(Radio);
/** Audible. Pair with `MutedIcon`, which is the same speaker crossed out. */
export const SpeakerIcon = makeIcon(Volume2);
export const MutedIcon = makeIcon(VolumeX);
export const BellIcon = makeIcon(Bell);
export const LayersIcon = makeIcon(Layers);
export const SettingsIcon = makeIcon(Settings);
export const SatelliteIcon = makeIcon(Satellite);
export const FullscreenEnterIcon = makeIcon(Maximize);
export const FullscreenExitIcon = makeIcon(Minimize);
export const DatabaseIcon = makeIcon(Database);
export const ComputerIcon = makeIcon(Computer);
export const DiagnosticsIcon = makeIcon(FileText);
export const PlusIcon = makeIcon(Plus, { strokeWidth: 2.4 });

export const CloseIcon = makeIcon(X);
export const PencilIcon = makeIcon(Pencil);
export const CheckIcon = makeIcon(Check);
export const GearIcon = SettingsIcon;
export const StarIcon = makeIcon(Star);
/**
 * Reputation, close to the in-game glyph. Reputation only, so one glyph does
 * not carry two unrelated meanings.
 */
export const HeartIcon = makeIcon(Heart);
/** Science. */
export const MicroscopeIcon = makeIcon(Microscope);
export const PlayIcon = makeIcon(Play);
export const PauseIcon = makeIcon(Pause);
export const StopIcon = makeIcon(Square);
export const ChevronUpIcon = makeIcon(ChevronUp);
export const ChevronDownIcon = makeIcon(ChevronDown);
export const ChevronLeftIcon = makeIcon(ChevronLeft);
export const ChevronRightIcon = makeIcon(ChevronRight);
export const ArrowLeftIcon = makeIcon(ArrowLeft);
export const ArrowUpIcon = makeIcon(ArrowUp);
export const ArrowRightIcon = makeIcon(ArrowRight);
export const ArrowDownIcon = makeIcon(ArrowDown);
export const PushUpIcon = makeIcon(ArrowUpToLine);
export const RecallIcon = makeIcon(Undo2);
export const HalfWidthIcon = makeIcon(Columns2);
export const FullWidthIcon = makeIcon(RectangleHorizontal);
export const HalfHeightIcon = makeIcon(Rows2);
export const FullHeightIcon = makeIcon(RectangleVertical);
/**
 * Commit what is composed, on a console's composer.
 *
 * The return carriage, the ⏎ on the key itself, since the button is an
 * addition to Enter and never a replacement for it. One meaning wherever it
 * appears: commit what the operator composed locally. Anything that fires on
 * its own takes a different icon.
 *
 * `aria-hidden` like every icon here, so drawn alone the action must be named
 * from outside (`ComposerBar`'s `sendLabel`, `CommandGroup`'s `commitAriaLabel`).
 */
export const SendIcon = makeIcon(CornerDownLeft);
