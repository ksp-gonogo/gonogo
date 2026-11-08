import { ArrowLeftRightIcon, Floating, IconButton } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useState } from "react";
import {
  CrewMoveListBody,
  useCanMove,
  useCrewMoveCommand,
} from "./CrewMoveList";

/** The Move control on a roster row. Drawn only when the kerbal has somewhere to go. */
export function CrewMoveControl({ name }: Readonly<{ name: string }>) {
  const canMove = useCanMove(name);
  const move = useCrewMoveCommand();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  if (!canMove) return null;
  return (
    <>
      <IconButton
        type="button"
        aria-label={`Move ${name}`}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setAnchor({ x: box.left, y: box.bottom });
        }}
      >
        <ArrowLeftRightIcon size={14} />
      </IconButton>
      {anchor && (
        <Floating anchor={anchor}>
          <CrewMoveListBody
            move={move}
            kerbalName={name}
            onDismiss={() => setAnchor(null)}
            style={MENU_IN_LAYER}
          />
        </Floating>
      )}
    </>
  );
}

const MENU_IN_LAYER: CSSProperties = { position: "static" };
