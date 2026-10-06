import type { AlertTone, Tone } from "@ksp-gonogo/sitrep-sdk";

export type {
  CrewAvatarContext,
  CrewBadgeContext,
  CrewRowToneEntry,
} from "@ksp-gonogo/sitrep-sdk";

/** The host's palette decision, and the only one: a contributor's tone becomes the `Card` tone here and nowhere else, an `info` row staying untinted. */
export const ROW_CARD_TONE: Record<AlertTone, Tone> = {
  info: "neutral",
  warn: "warn",
  nogo: "nogo",
};
