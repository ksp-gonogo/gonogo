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
  return <WidgetScene {...scene} withhold={enabled ? [] : [extension]} />;
}
