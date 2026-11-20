import type { ModeDefinition } from "@ksp-gonogo/core";
import type { ReactNode } from "react";
import { ModeLayerProvider } from "../../modes/ModeLayerProvider";
import { ActiveModePane } from "./ActiveModePane";

/**
 * A screen's tiles with the dashboard's mode around them: the mode's pane and
 * Timeline, which the screen's own layout keeps clear of, and the mode's values laid over the live stream
 * for the tiles and the pane's sections alike. Used by the main screen and by
 * a station.
 */
export function ModeFrame({
  titleFor,
  ownPlace = false,
  layered = true,
  children,
}: {
  titleFor: (mode: ModeDefinition) => string;
  /** Whether this screen may leave the shared timeline for a place of its own: every screen but the one that hosts. */
  ownPlace?: boolean;
  /** False where the screen has already laid the mode's values over more than the tiles, with {@link ModeLayerProvider} round its header as well. */
  layered?: boolean;
  children: ReactNode;
}) {
  const framed = (
    <>
      <ActiveModePane titleFor={titleFor} ownPlace={ownPlace} />
      {children}
    </>
  );
  return layered ? <ModeLayerProvider>{framed}</ModeLayerProvider> : framed;
}
