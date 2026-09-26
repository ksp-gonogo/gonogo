import { value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, Unit } from "@ksp-gonogo/ui-kit";

export function formatMissionTime(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return NULL_DISPLAY;
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) {
    return `T+${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `T+${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

// Through the shared `length` ladder, so a Mun transfer reads in Mm.
export function Altitude({ m }: { m: number | null }) {
  if (m === null) return NULL_DISPLAY;
  return <Unit value={value("m", m)} />;
}
