import { Button } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

/**
 * The control that starts a playback story over. `uplink-tools story` finds it
 * by its marker, so it can be pressed while the picture is cropped to the widget.
 */
export function PlaybackStart({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button size="sm" data-story-start="" onClick={onClick}>
      {children}
    </Button>
  );
}
