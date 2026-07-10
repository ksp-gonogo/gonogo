import { Fab, FullscreenEnterIcon, FullscreenExitIcon } from "@ksp-gonogo/ui";
import { useEffect, useState } from "react";

/**
 * Toggles the browser into fullscreen on the document root. Listens for
 * `fullscreenchange` so the icon stays in sync when the user exits via Esc
 * rather than clicking the button again.
 */
export function FullscreenFab({ bottom = 384 }: { bottom?: number } = {}) {
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== "undefined" && !!document.fullscreenElement,
  );

  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
    };
  }, []);

  async function handleClick() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Fullscreen can reject (permissions policy, unsupported browser). The
      // failure is self-evident — the screen doesn't change — so no need to
      // surface anything here.
    }
  }

  const label = isFullscreen ? "Exit fullscreen" : "Enter fullscreen";

  return (
    <Fab bottom={bottom} onClick={handleClick} aria-label={label} title={label}>
      {isFullscreen ? <FullscreenExitIcon /> : <FullscreenEnterIcon />}
    </Fab>
  );
}
