import { useGameStatus } from "@ksp-gonogo/sitrep-client";
import { BannerPill } from "@ksp-gonogo/ui";

const SCENE_NAMES: Record<string, string> = {
  FLIGHT: "Flight",
  SPACECENTER: "Space Center",
  TRACKSTATION: "Tracking Station",
  EDITOR: "Editor",
  MAINMENU: "Main Menu",
};

/**
 * Says what holds every reading: KSP loading a scene, or no game at all at its
 * main menu. Owns every load, so the scene-change notice has none of its own.
 * Shown only once a load has run long enough to be worth saying, which the
 * store decides.
 */
export function GameLoadingBanner() {
  const { state, scene } = useGameStatus();
  if (state === "ready") return null;
  if (state === "no-game") {
    return (
      <BannerPill accent="var(--color-warn-mark)">No game loaded</BannerPill>
    );
  }
  return (
    <BannerPill accent="var(--color-warn-mark)" pulse>
      KSP is loading {SCENE_NAMES[scene] ?? scene}
    </BannerPill>
  );
}
