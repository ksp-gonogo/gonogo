import { useGameContext } from "@ksp-gonogo/core";
import { FabPrompt } from "@ksp-gonogo/ui";
import { useEffect, useRef, useState } from "react";
import type { Layouts } from "react-grid-layout";
import type { DashboardItem } from "../components/Dashboard";
import { useMissionProfilesService } from "./MissionProfilesContext";
import type { BindableScene, MissionProfile } from "./MissionProfilesService";

interface SceneSwitchPromptProps {
  /** Called when the profile is loaded — either via the prompt or auto-switch. */
  onLoad: (items: DashboardItem[], layouts: Layouts) => void;
}

/**
 * Watches `kc.scene` and shows a sausage-shaped prompt next to the
 * dashboard FAB whenever a fresh scene transition arrives that matches
 * a tagged Mission Profile. Tap the prompt → atomic dashboard swap;
 * dismiss → it goes away and won't return until the next *new* scene
 * transition.
 *
 * If the matching profile has `autoSwitch === true`, the swap fires
 * immediately and no prompt is shown.
 *
 * The model is "never switch away because of a scene change, only
 * switch *to* a profile when entering a tagged scene". Initial mount
 * is treated as a non-transition so reloading the page doesn't fire
 * a prompt for whatever scene the host happens to be in.
 *
 * Designed to live inside a `BannerStack`, so positioning is in-flow —
 * no `bottom` prop. The stack owns viewport placement.
 */
export function SceneSwitchPrompt({
  onLoad,
}: Readonly<SceneSwitchPromptProps>) {
  const { scene } = useGameContext();
  const svc = useMissionProfilesService();
  const previousSceneRef = useRef<string | null>(null);
  const [active, setActive] = useState<{
    scene: BindableScene;
    profile: MissionProfile;
  } | null>(null);

  useEffect(() => {
    const previous = previousSceneRef.current;
    previousSceneRef.current = scene ?? null;

    // Initial mount has no previous, treat it as non-transition.
    if (previous === null) return;
    if (!scene) return;
    if (scene === previous) return;

    const profile = svc.findForScene(scene);
    if (!profile) {
      // No binding — leave any existing prompt alone (it's for the
      // previous transition, the auto-dismiss will clear it).
      return;
    }

    if (profile.autoSwitch) {
      onLoad(profile.items, profile.layouts);
      setActive(null);
      return;
    }

    setActive({ scene: scene as BindableScene, profile });
  }, [scene, svc, onLoad]);

  if (!active) return null;

  return (
    <FabPrompt
      label={`Switch to ${active.profile.name}?`}
      acceptLabel={`Load layout ${active.profile.name}`}
      onAccept={() => {
        onLoad(active.profile.items, active.profile.layouts);
        setActive(null);
      }}
      onDismiss={() => setActive(null)}
    />
  );
}
