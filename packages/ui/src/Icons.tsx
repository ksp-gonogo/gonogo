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
  FileText,
  History,
  Joystick,
  Layers,
  type LucideProps,
  Maximize,
  Minimize,
  Play,
  Plus,
  Radio,
  Satellite,
  Settings,
  Square,
  Star,
  Undo2,
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

// Existing exports — kept stable so call sites don't change.
export const JoystickIcon = makeIcon(Joystick);
export const HistoryIcon = makeIcon(History);
export const BroadcastIcon = makeIcon(Radio);
export const BellIcon = makeIcon(Bell);
export const LayersIcon = makeIcon(Layers);
export const SettingsIcon = makeIcon(Settings);
export const SatelliteIcon = makeIcon(Satellite);
export const FullscreenEnterIcon = makeIcon(Maximize);
export const FullscreenExitIcon = makeIcon(Minimize);
export const DiagnosticsIcon = makeIcon(FileText);
export const PlusIcon = makeIcon(Plus, { strokeWidth: 2.4 });

// New exports — replacements for inline unicode glyphs.
export const CloseIcon = makeIcon(X);
export const CheckIcon = makeIcon(Check);
export const GearIcon = SettingsIcon;
export const StarIcon = makeIcon(Star);
export const PlayIcon = makeIcon(Play);
export const StopIcon = makeIcon(Square);
export const ChevronUpIcon = makeIcon(ChevronUp);
export const ChevronDownIcon = makeIcon(ChevronDown);
export const ChevronRightIcon = makeIcon(ChevronRight);
export const ArrowLeftIcon = makeIcon(ArrowLeft);
export const ArrowUpIcon = makeIcon(ArrowUp);
export const ArrowRightIcon = makeIcon(ArrowRight);
export const PushUpIcon = makeIcon(ArrowUpToLine);
export const RecallIcon = makeIcon(Undo2);
