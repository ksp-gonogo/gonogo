import { plantSlot, SlotStub } from "./stub";

/** Fills the viewport frame behind the reticle, where a camera feed would sit. */
plantSlot("targeting.camera", ({ cameraFlightId }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "flex-end",
      padding: 4,
      background: "var(--color-surface-sunken)",
    }}
  >
    <SlotStub slot="targeting.camera">
      camera {cameraFlightId ?? "auto"}
    </SlotStub>
  </div>
));

/** A dashed ring on the reticle, placed through the HUD's own travel, and a label carrying the raw angles. */
plantSlot("targeting.overlay", ({ reticleOffset, reticleTravelPx, ax, ay }) => (
  <>
    <div
      style={{
        position: "absolute",
        left: `calc(50% + ${reticleOffset.x * reticleTravelPx}px)`,
        top: `calc(50% + ${reticleOffset.y * reticleTravelPx}px)`,
        transform: "translate(-50%, -50%)",
        width: 40,
        height: 40,
        border: "1px dashed var(--color-status-info-fg)",
        borderRadius: "50%",
      }}
    />
    <div style={{ position: "absolute", top: 4, left: 4 }}>
      <SlotStub slot="targeting.overlay">
        {ax?.toFixed(1) ?? "?"}° / {ay?.toFixed(1) ?? "?"}°
      </SlotStub>
    </div>
  </>
));
