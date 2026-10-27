import { useCommand, useStream } from "@ksp-gonogo/sitrep-client";
import { type EvaKerbal, stillTrue, type WireOf } from "@ksp-gonogo/sitrep-sdk";
import {
  Card,
  HelmetIcon,
  HelmetVisorUpIcon,
  IconButton,
  KitIcon,
  LampIcon,
  LampOffIcon,
  ReadoutCaption,
  Tooltip,
  Truncate,
} from "@ksp-gonogo/ui-kit";
import { evaKerbalTopic } from "../ScienceData/parsers";

/** A kerbal's own Topic as it arrives: a dynamic Topic has no declared units, so its counts are bare numbers. */
type EvaKerbalWire = WireOf<EvaKerbal>;

/** The state the helmet icon draws, or null when the kerbal's helmet could not be read. */
export function helmetFace(
  state: Pick<EvaKerbalWire, "helmetOn" | "visorState"> | undefined,
): { label: string; visorUp: boolean; muted: boolean } | null {
  if (state?.helmetOn === undefined || state.helmetOn === null) return null;
  if (!state.helmetOn) {
    return { label: "Helmet off", visorUp: false, muted: true };
  }
  const raised =
    state.visorState === "Raised" || state.visorState === "Raising";
  return raised
    ? { label: "Helmet on, visor up", visorUp: true, muted: false }
    : { label: "Helmet on, visor down", visorUp: false, muted: false };
}

/** One line per thing carried, for the kit icon's hover and its accessible name. */
export function kitLabel(
  carrying: EvaKerbalWire["carrying"],
  slotsUsed: number | null | undefined,
): { count: number; label: string } | null {
  if (!carrying) return null;
  const count = slotsUsed ?? carrying.length;
  if (carrying.length === 0) return { count, label: "Carrying nothing" };
  const items = carrying.map((item) => {
    const name = item.title || item.name;
    const quantity = item.quantity;
    return quantity > 1 ? `${name} x${quantity}` : name;
  });
  return { count, label: `Carrying ${items.join(", ")}` };
}

/**
 * The icons and the EVA caption on one centre line with the name. The card's title line
 * aligns its children on a text baseline, so this group centres on the line instead, and it
 * has no height of its own: its contents are centred on that zero-height box, so the name's
 * line alone sets the row height and the group sits on the line's centre.
 */
const ICON_ROW = {
  display: "inline-flex",
  alignItems: "center",
  alignSelf: "center",
  height: 0,
  gap: "var(--gap-related)",
} as const;

/** The lamp button centres its icon itself: left inline, the icon rides the text baseline and sits high in the button. */
const LAMP_BUTTON = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

/** One kerbal outside the craft: named and marked as out, with helmet, kit and lamp read off the kerbal's own Topic. */
export function EvaKerbalRow({
  kerbalVesselId,
  name,
}: Readonly<{ kerbalVesselId: string | null | undefined; name: string }>) {
  const reading = useStream<EvaKerbalWire>(
    kerbalVesselId ? evaKerbalTopic(kerbalVesselId) : "",
  );
  const state = stillTrue(reading, undefined) ?? undefined;
  const lampOn = typeof state?.lampOn === "boolean" ? state.lampOn : undefined;
  const lamp = useCommand("eva.kerbal.setLamp", {
    confirmedBy: (args) => lampOn === args.enabled,
  });
  const helmet = helmetFace(state);
  const kit = kitLabel(state?.carrying, state?.slotsUsed);

  const pressLamp = () => {
    if (!kerbalVesselId || lampOn === undefined) return;
    void lamp
      .send(
        { kerbalVesselId, enabled: !lampOn },
        { label: `${name} lamp ${lampOn ? "off" : "on"}` },
      )
      .catch(() => {});
  };

  return (
    <Card
      as="li"
      title={<Truncate>{name}</Truncate>}
      titleRight={
        <span style={ICON_ROW}>
          {helmet && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                opacity: helmet.muted ? 0.55 : 1,
              }}
            >
              {helmet.visorUp ? (
                <HelmetVisorUpIcon label={helmet.label} />
              ) : (
                <HelmetIcon label={helmet.label} />
              )}
            </span>
          )}
          {kit && (
            <Tooltip text={kit.label}>
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
              >
                <KitIcon label={kit.label} />
                <ReadoutCaption>{kit.count}</ReadoutCaption>
              </span>
            </Tooltip>
          )}
          <IconButton
            aria-label={
              lampOn === undefined ? "Lamp" : lampOn ? "Lamp on" : "Lamp off"
            }
            pressed={lampOn === true}
            disabled={lampOn === undefined || !kerbalVesselId}
            disabledReason={
              lampOn === undefined ? "Lamp state not reported" : undefined
            }
            style={LAMP_BUTTON}
            aria-busy={lamp.inFlight.length > 0}
            onClick={pressLamp}
          >
            {lampOn === false ? (
              <LampOffIcon />
            ) : (
              <LampIcon fill={lampOn ? "currentColor" : "none"} />
            )}
          </IconButton>
          <ReadoutCaption>EVA</ReadoutCaption>
        </span>
      }
    />
  );
}
