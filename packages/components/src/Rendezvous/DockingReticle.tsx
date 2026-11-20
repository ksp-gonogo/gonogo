/** Fixed crosshair through the HUD centre: two hairline rules, no pseudo-elements. */
export function Crosshair() {
  const line = {
    position: "absolute" as const,
    background: "color-mix(in srgb, var(--color-accent-fg) 75%, transparent)",
  };
  return (
    <div
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      <div
        style={{
          ...line,
          left: 0,
          right: 0,
          top: "50%",
          height: 1,
          transform: "translateY(-0.5px)",
        }}
      />
      <div
        style={{
          ...line,
          top: 0,
          bottom: 0,
          left: "50%",
          width: 1,
          transform: "translateX(-0.5px)",
        }}
      />
    </div>
  );
}

/** Target reticle drifting in proportion to the docking alignment angles. */
export function Reticle({
  aligned,
  left,
  top,
}: {
  aligned: boolean;
  left: string;
  top: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        width: 22,
        height: 22,
        border: `var(--border-width-strong) solid ${aligned ? "var(--color-accent-fg)" : "var(--color-warn-mark)"}`,
        borderRadius: "var(--radius-circle)",
        transform: "translate(-50%, -50%)",
        // An instant telemetry chase for left/top; only the border colour eases.
        transition:
          "left var(--duration-instant) var(--ease-linear), top var(--duration-instant) var(--ease-linear), border-color var(--duration-base) var(--ease-linear)",
        // Ring only, so the crosshair stays visible.
        boxShadow: `0 0 6px ${aligned ? "color-mix(in srgb, var(--color-accent-fg) 60%, transparent)" : "color-mix(in srgb, var(--color-diagram-docking-misaligned) 50%, transparent)"}`,
        left,
        top,
      }}
    />
  );
}

// Derived tick geometry, off the spacing scale: a hairline rule and half-length translates centring the tick.
export function HorizTick({ left }: { left: string }) {
  return (
    <div
      style={{
        position: "absolute",
        background:
          "color-mix(in srgb, var(--color-accent-fg) 35%, transparent)",
        pointerEvents: "none",
        top: "50%",
        width: 1,
        height: 8,
        transform: "translateY(-4px)",
        left,
      }}
    />
  );
}

export function VertTick({ top }: { top: string }) {
  return (
    <div
      style={{
        position: "absolute",
        background:
          "color-mix(in srgb, var(--color-accent-fg) 35%, transparent)",
        pointerEvents: "none",
        left: "50%",
        height: 1,
        width: 8,
        transform: "translateX(-4px)",
        top,
      }}
    />
  );
}
