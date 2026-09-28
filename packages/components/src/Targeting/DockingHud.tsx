import { AugmentSlot } from "@ksp-gonogo/core";
import type { ReckoningBasis } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  FramedDisplay,
  Grid,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Text,
  Truncate,
  Unit,
  useElementSize,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { Crosshair, HorizTick, Reticle, VertTick } from "./DockingReticle";
import { reticleTravelPx } from "./reticleGeometry";
import type { TargetingHudContext } from "./slots";

interface DockingHudProps {
  name: string;
  distance: number | undefined;
  relVel: number | undefined;
  ax: number | undefined;
  ay: number | undefined;
  az: number | undefined;
  x: number | undefined;
  y: number | undefined;
  /** Cosine of the angle between the two ports' forward vectors (1 = aligned); takes priority for the reticle tint. */
  forwardDot: number | undefined;
  /** Present when the separation was carried forward rather than observed, with the model's basis. */
  modelled: { basis: ReckoningBasis } | undefined;
  showCamera: boolean;
  cameraFlightId: number | null | undefined;
  cols: number;
  rows: number;
}

/**
 * Compact docking HUD: a fixed crosshair with the target reticle drifting in
 * proportion to the alignment angles, clamped at ~8° to the box edge.
 */
export function DockingHud(props: DockingHudProps) {
  const {
    name,
    distance,
    relVel,
    ax,
    ay,
    az,
    x,
    y,
    forwardDot,
    modelled,
    showCamera,
    cameraFlightId,
    cols,
    rows,
  } = props;

  // Wide and short: reticle on the left, readouts beside it.
  const wideShort = cols >= 12 && rows < 6;
  // Too small for a useful reticle, except in the wide-short row layout.
  const showViewport = wideShort || (rows >= 6 && cols >= 4);
  // Narrow: the paired grid cannot hold the readouts without wrapping.
  const stackReadouts = cols < 5;
  // The smallest size keeps only Δv, the headline closing cue.
  const showAlignmentDetail = cols >= 4;

  // Past ±8° the pilot is reorienting, not docking, so the reticle clamps.
  const MAX_DEG = 8;
  const axClamped =
    ax === undefined ? 0 : Math.max(-MAX_DEG, Math.min(MAX_DEG, ax));
  const ayClamped =
    ay === undefined ? 0 : Math.max(-MAX_DEG, Math.min(MAX_DEG, ay));
  // -ay puts "nose up" at top.
  const dx = axClamped / MAX_DEG;
  const dy = -ayClamped / MAX_DEG;

  const { ref: layerRef, size: layer } = useElementSize<HTMLDivElement>({
    w: 1,
    h: 1,
  });
  const [pictureAspect, reportPictureAspect] = useState<number | null>(null);
  const travel = reticleTravelPx(
    { width: layer.w, height: layer.h },
    showCamera ? pictureAspect : null,
  );
  // The reticle stays in the frame even where the picture's own field runs past it.
  const along = (offset: number, half: number) =>
    `calc(50% + ${Math.max(-half, Math.min(half, offset * travel))}px)`;
  const tick = (units: number) => `calc(50% + ${units * travel}px)`;

  // 0.9998 is within about 1° of dead-on, matching the derived-angle threshold.
  const aligned =
    forwardDot !== undefined
      ? forwardDot > 0.9998
      : ax !== undefined &&
        ay !== undefined &&
        Math.abs(ax) < 1 &&
        Math.abs(ay) < 1;

  // Positive relVel is opening, the KSP convention.
  const closing = relVel !== undefined && Number.isFinite(relVel) && relVel < 0;

  const hudContext: TargetingHudContext = {
    maxDeg: MAX_DEG,
    reticleOffset: { x: dx, y: dy },
    reticleTravelPx: travel,
    reportPictureAspect,
    aligned,
    ax,
    ay,
    distance,
    cameraFlightId,
  };

  return (
    <Panel
      role="region"
      aria-label={`Docking HUD for ${name}`}
      panelTitle="DOCKING"
      sections={
        /* One filling section: the wide-short layout needs the readouts BESIDE the viewport, hence the inline direction. */
        <Section
          full
          fill
          gap="related-dense"
          style={{ flexDirection: wideShort ? "row" : "column" }}
        >
          {showViewport && (
            /* A frame inside the padded body, which also divides the two halves. */
            <FramedDisplay style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
              {/* Gated like the video it hosts: not in the HUD-only variant, not when too small. The frame is what the augment's `inset: 0` resolves against. */}
              {showCamera && (
                <AugmentSlot name="targeting.camera" props={hudContext} />
              )}
              <div
                ref={layerRef}
                style={{
                  position: "relative",
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                  background:
                    "radial-gradient(circle at center, rgba(0, 255, 136, 0.08) 0%, rgba(0, 0, 0, 0.3) 70%)",
                }}
              >
                <Crosshair />
                <Reticle
                  aligned={aligned}
                  left={along(dx, layer.w / 2)}
                  top={along(dy, layer.h / 2)}
                />
                {/* Axis ticks at half and full travel give the pilot the scale, the same on both axes. */}
                {[-1, -0.5, 0.5, 1].map((units) => (
                  <HorizTick key={`h${units}`} left={tick(units)} />
                ))}
                {[-1, -0.5, 0.5, 1].map((units) => (
                  <VertTick key={`v${units}`} top={tick(units)} />
                ))}
                <AugmentSlot name="targeting.overlay" props={hudContext} />
              </div>
            </FramedDisplay>
          )}

          <div
            style={
              /* Wide-short: a fixed-width right column, centred vertically. */
              wideShort
                ? {
                    flex: "0 0 240px",
                    alignSelf: "stretch",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                  }
                : undefined
            }
          >
            <Cluster
              justify="between"
              align="baseline"
              style={{ gap: "var(--gap-headline)" }}
            >
              <Truncate
                style={{
                  fontSize: "var(--font-size-value)",
                  color: "var(--color-status-go-fg)",
                  letterSpacing: "0.04em",
                }}
              >
                {name}
              </Truncate>
              <Text
                size="lg"
                tone="accent"
                style={{ fontWeight: 700, whiteSpace: "nowrap" }}
              >
                {distance === undefined ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={value("m", distance)} />
                )}
              </Text>
            </Cluster>
            <Grid
              cols={stackReadouts ? "1fr" : "auto 1fr"}
              gap="label-value"
              style={{
                rowGap: "var(--gap-line)",
                marginTop: "var(--gap-sub-readout)",
              }}
            >
              <ReadoutCaption
                style={{
                  color: "var(--color-status-go-fg)",
                  letterSpacing: "0.12em",
                  whiteSpace: "nowrap",
                }}
              >
                Δv
              </ReadoutCaption>
              <Text
                style={{
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  color: closing
                    ? "var(--color-accent-fg)"
                    : "var(--color-status-warning-bg)",
                }}
              >
                {relVel === undefined || !Number.isFinite(relVel) ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={value("m/s", relVel)} decimals={2} />
                )}
              </Text>

              {showAlignmentDetail && (
                <>
                  <ReadoutCaption
                    style={{
                      color: "var(--color-status-go-fg)",
                      letterSpacing: "0.12em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    X/Y
                  </ReadoutCaption>
                  <Text
                    style={{
                      fontSize: 11,
                      whiteSpace: "nowrap",
                      color: "var(--color-status-go-fg)",
                    }}
                  >
                    {x === undefined ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={value("m", x)} decimals={2} />
                    )}{" "}
                    /{" "}
                    {y === undefined ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={value("m", y)} decimals={2} />
                    )}
                  </Text>

                  <ReadoutCaption
                    style={{
                      color: "var(--color-status-go-fg)",
                      letterSpacing: "0.12em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    α/β/γ
                  </ReadoutCaption>
                  <Text
                    style={{
                      fontSize: 11,
                      whiteSpace: "nowrap",
                      color: "var(--color-status-go-fg)",
                    }}
                  >
                    {ax === undefined ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={value("°", ax)} decimals={1} />
                    )}{" "}
                    ·{" "}
                    {ay === undefined ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={value("°", ay)} decimals={1} />
                    )}{" "}
                    ·{" "}
                    {az === undefined ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={value("°", az)} decimals={1} />
                    )}
                  </Text>
                </>
              )}
            </Grid>
            {modelled && (
              <ReadoutCaption role="status">
                Alignment reckoned ({modelled.basis})
              </ReadoutCaption>
            )}
          </div>
        </Section>
      }
    />
  );
}
