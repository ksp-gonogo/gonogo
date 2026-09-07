import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpToLine,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns2,
  Computer,
  CornerDownLeft,
  Database,
  FileText,
  Heart,
  History,
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

const ICON_DEFAULTS: LucideProps = {
  size: 20,
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

// Existing exports: kept stable so call sites don't change.
export const JoystickIcon = makeIcon(Joystick);
export const HistoryIcon = makeIcon(History);
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

// New exports: replacements for inline unicode glyphs.
export const CloseIcon = makeIcon(X);
export const PencilIcon = makeIcon(Pencil);
export const CheckIcon = makeIcon(Check);
export const GearIcon = SettingsIcon;
export const StarIcon = makeIcon(Star);
/**
 * Reputation, per the currency-icon trial. Close to the in-game glyph.
 *
 * Reputation ONLY. FlightsManager's "starred flight" is `HeartIcon`, so that
 * one glyph does not carry two unrelated meanings.
 */
export const HeartIcon = makeIcon(Heart);
/** Science, per the currency-icon trial. */
export const MicroscopeIcon = makeIcon(Microscope);
export const PlayIcon = makeIcon(Play);
export const PauseIcon = makeIcon(Pause);
export const StopIcon = makeIcon(Square);
export const ChevronUpIcon = makeIcon(ChevronUp);
export const ChevronDownIcon = makeIcon(ChevronDown);
export const ChevronRightIcon = makeIcon(ChevronRight);
export const ArrowLeftIcon = makeIcon(ArrowLeft);
export const ArrowUpIcon = makeIcon(ArrowUp);
export const ArrowRightIcon = makeIcon(ArrowRight);
export const PushUpIcon = makeIcon(ArrowUpToLine);
export const RecallIcon = makeIcon(Undo2);
export const HalfWidthIcon = makeIcon(Columns2);
export const FullWidthIcon = makeIcon(RectangleHorizontal);
export const HalfHeightIcon = makeIcon(Rows2);
export const FullHeightIcon = makeIcon(RectangleVertical);
/**
 * Commit what is composed, on a console's composer.
 *
 * The RETURN CARRIAGE, the ⏎ on the key itself: a rule running right, turning
 * down and coming back with an arrowhead. A paper plane was here first and read
 * as a messaging app rather than as a console: "I don't like the submit icon,
 * it's too app-y. I want more of a return carriage icon."
 *
 * It also says the true thing about the control. The button is an addition to
 * Enter and never a replacement for it (see `ComposerBar.onSend`), so a glyph
 * that IS the Enter key names the key an operator should be using, where a send
 * arrow named a second way to do it. `ComposerBar` is the only thing that draws
 * it, so the glyph means one thing wherever an operator meets it.
 */
export const SendIcon = makeIcon(CornerDownLeft);
