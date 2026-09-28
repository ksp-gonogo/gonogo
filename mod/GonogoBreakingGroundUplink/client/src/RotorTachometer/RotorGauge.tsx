import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { value as quantity } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  Gauge,
  Section,
  useElementSize,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { ROTOR_MAX_RPM, type RotorInfo } from "./rotors";

/** The selected rotor's dial: its rpm reading, marked when held, against the commanded cap. */
export function RotorGauge({
  rotor,
  rpmReading,
  rows,
}: {
  rotor: RotorInfo;
  rpmReading: Reading<Value<"rpm">>;
  rows: number | undefined;
}) {
  // The dial follows the column width so it does not clip in a narrow slot.
  const { ref: gaugeRef, size: gaugeSize } = useElementSize({ w: 180, h: 104 });
  // With the cap unread the dial draws no zones rather than an arc ending at a substitute.
  const cap = rotor.rpmLimit === null ? null : Math.max(rotor.rpmLimit, 1);
  // Capped by a slice of the widget's height so the controls stay visible without scrolling.
  const gaugeMaxH = Math.max(64, (rows ?? 9) * 25 * 0.32);
  const gaugeW = Math.min(
    gaugeSize.w || 180,
    240,
    Math.round(gaugeMaxH / 0.58),
  );
  const gaugeH = Math.round(gaugeW * 0.58);

  return (
    <Section>
      <Cluster justify="center" ref={gaugeRef}>
        <Gauge
          value={rpmReading}
          min={quantity("rpm", 0)}
          max={quantity("rpm", ROTOR_MAX_RPM)}
          width={gaugeW}
          height={gaugeH}
          zones={
            cap === null
              ? undefined
              : [
                  {
                    from: quantity("rpm", 0),
                    to: quantity("rpm", cap),
                    color: "var(--color-go-status)",
                  },
                  {
                    from: quantity("rpm", cap),
                    to: quantity("rpm", ROTOR_MAX_RPM),
                    color: "var(--color-surface-raised)",
                  },
                ]
          }
          ariaLabel={`${rotor.name}: ${
            rpmReading.value == null
              ? "RPM unknown"
              : writeQuantity(rpmReading.value)
          }, ${
            rotor.rpmLimit === null
              ? "cap unknown"
              : `cap ${writeQuantity(quantity("rpm", rotor.rpmLimit))}`
          }`}
        />
      </Cluster>
    </Section>
  );
}
