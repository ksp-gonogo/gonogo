import { WidgetScene, type WidgetSceneProps } from "./WidgetScene";

export interface ExtensionSceneProps
  extends Omit<WidgetSceneProps, "withhold"> {
  /** The augment or contribution id the story is about. */
  extension: string;
  /** Off, the extension is taken out of its registry and the host renders without it. */
  enabled: boolean;
}

/** A host widget on a scene that exercises one extension, with the extension switchable. */
export function ExtensionScene({
  extension,
  enabled,
  ...scene
}: ExtensionSceneProps) {
  // A click that reveals the extension's own mount (a tab, a panel) has nothing to find once the extension is withheld, so it runs only while the scene is on.
  const mode = enabled ? scene.mode : { ...scene.mode, clicks: undefined };
  return (
    <WidgetScene {...scene} mode={mode} withhold={enabled ? [] : [extension]} />
  );
}
