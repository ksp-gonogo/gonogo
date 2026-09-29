import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  Inline,
  NULL_DISPLAY,
  ReadoutCaption,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { rateDecimals } from "./rates";

/** Whole-widget summary: process count, active count, net EC draw, and location. */
export function ResourceOpsStats({
  total,
  activeCount,
  netEc,
  netEcHeld,
  location,
}: Readonly<{
  total: number;
  /** Withheld (`undefined`) while either channel's run flags are held. */
  activeCount: number | undefined;
  netEc: { moves: boolean; net: number | null };
  /** Whether `netEc.net` is a held figure rather than the vessel's current draw. */
  netEcHeld: boolean;
  location: string | undefined;
}>) {
  return (
    <Cluster
      justify="start"
      wrap
      role="group"
      aria-label="Resource ops summary"
      // Each stat pairs at the related gap inside, so stats separate at the section gap.
      style={{ gap: "var(--gap-section)" }}
    >
      <Inline>
        <Text size="sm" tone="default" weight="semibold">
          {total}
        </Text>
        <ReadoutCaption>{total === 1 ? "process" : "processes"}</ReadoutCaption>
      </Inline>
      <Inline>
        <Text size="sm" tone="default" weight="semibold">
          {activeCount ?? NULL_DISPLAY}
        </Text>
        <ReadoutCaption>active</ReadoutCaption>
      </Inline>
      {/* Stays mounted while the figure is withheld: whether the vessel moves ElectricCharge is a recipe fact. */}
      {netEc.moves && (
        <Inline>
          <ReadoutCaption>net EC</ReadoutCaption>
          {netEcHeld || netEc.net === null ? (
            <Text tone="muted">{NULL_DISPLAY}</Text>
          ) : (
            <Unit
              value={value("units/s", netEc.net)}
              decimals={rateDecimals(netEc.net, 2)}
            />
          )}
        </Inline>
      )}
      {location && (
        <Inline>
          <ReadoutCaption>at</ReadoutCaption>
          <Text size="sm" tone="default">
            {location}
          </Text>
        </Inline>
      )}
    </Cluster>
  );
}
