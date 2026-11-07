import { useCommand, useStream } from "@ksp-gonogo/sitrep-client";
import { type EvaKerbal, stillTrue, type WireOf } from "@ksp-gonogo/sitrep-sdk";
import {
  Card,
  CommandButton,
  HelmetIcon,
  HelmetVisorUpIcon,
  KitIcon,
  LampIcon,
  LampOffIcon,
  ReadoutCaption,
  Tooltip,
  useCommandButton,
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
 * aligns its children on a text baseline, so this group centres on the line instead. It keeps
 * a height of its own, so on a line of its own (a narrow tile) it sits below the name rather
 * than drawing over it.
 */
const ICON_ROW = {
  display: "inline-flex",
  alignItems: "center",
  alignSelf: "center",
  gap: "var(--gap-related)",
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

  const lampLabel = `${name} lamp`;
  const lampButton = useCommandButton({
    handle: lamp,
    commandLabel: lampLabel,
    toggle: {
      state: lampOn,
      name: lampLabel,
      word: () => "Lamp",
      words: ["Lamp"],
      // Every kerbal shares one lamp command, so a row is this kerbal's by its label.
      rows: (row) => row.label === lampLabel,
      unavailable:
        lampOn === undefined || !kerbalVesselId
          ? "Lamp state not reported"
          : state?.focused === false
            ? "Switch to this kerbal to use the lamp"
            : null,
      args: (base) =>
        kerbalVesselId && typeof base === "boolean"
          ? { kerbalVesselId, enabled: !base }
          : undefined,
    },
  });
  return (
    <Card
      as="li"
      titleGap="related"
      title={name}
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
          <CommandButton
            size="sm"
            handle={lamp}
            controller={lampButton}
            label="Lamp"
            icon={
              lampButton.toggleView?.shown === false ? (
                <LampOffIcon />
              ) : (
                <LampIcon
                  fill={lampButton.toggleView?.shown ? "currentColor" : "none"}
                />
              )
            }
            title={lampButton.isBlocked ? undefined : lampLabel}
            aria-label={lampLabel}
          />
          <ReadoutCaption>EVA</ReadoutCaption>
        </span>
      }
    />
  );
}
