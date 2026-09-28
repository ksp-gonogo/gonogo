import type {
  UplinkHealthEntry,
  UplinkHealthStateName,
} from "@ksp-gonogo/sitrep-client";
import { Button } from "@ksp-gonogo/ui";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { Fragment } from "react";
import styled from "styled-components";
import { revokeConsent } from "../uplinks/consent";
import type {
  UplinkLoadOutcome,
  UplinkLoadStatus,
} from "../uplinks/loaderState";
import { UplinkIdentityBlock } from "../uplinks/UplinkIdentityBlock";
import { UplinkIntegrityDetail } from "../uplinks/UplinkIntegrityDetail";
import { UplinkSkewOverride } from "../uplinks/UplinkSkewOverride";
import { ConnectionRow, Name } from "./SitrepConnection";

/**
 * The mod half's own report of its health, from `system.uplinkHealth`. Each
 * Uplink reports for itself; nothing here infers readiness from a quiet topic.
 */
export function UplinkHealthReport({ entry }: { entry: UplinkHealthEntry }) {
  const detail =
    entry.health.detail ?? (!entry.available ? entry.reason : null);
  return (
    <StatusItem>
      <ConnectionRow>
        <Indicator $color={healthColor[entry.health.state]} />
        <Name>Mod</Name>
        <Version>v{entry.version}</Version>
        <StatusLabel $color={healthColor[entry.health.state]}>
          {entry.health.state}
        </StatusLabel>
      </ConnectionRow>
      {detail && <Detail>{detail}</Detail>}
      {/* The identity of whatever the Uplink depends on, which an operator copies into a bug report: labels and values are the Uplink's own. */}
      {entry.health.facts.length > 0 && (
        <Facts>
          {entry.health.facts.map((fact) => (
            <Fragment key={fact.label}>
              <FactLabel>{fact.label}</FactLabel>
              <FactValue>{fact.value ?? NULL_DISPLAY}</FactValue>
            </Fragment>
          ))}
        </Facts>
      )}
    </StatusItem>
  );
}

/**
 * What the runtime loader made of the Uplink's client bundle: loaded, or
 * quarantined with the reason, so a refusal is never silent.
 */
export function UplinkClientStatus({
  outcome,
}: {
  outcome: UplinkLoadOutcome;
}) {
  return (
    <StatusItem>
      <ConnectionRow>
        <Indicator $color={loaderColor[outcome.status]} />
        <Name>Client</Name>
        {outcome.version && <Version>v{outcome.version}</Version>}
        <StatusLabel $color={loaderColor[outcome.status]}>
          {outcome.status}
        </StatusLabel>
      </ConnectionRow>
      {outcome.identity && (
        <UplinkIdentityBlock identity={outcome.identity} live />
      )}
      {/* Says which kind of refusal it was; the reason below stays the diagnostic line. */}
      {outcome.integrity && (
        <UplinkIntegrityDetail failure={outcome.integrity} />
      )}
      {outcome.reason && <Detail>{outcome.reason}</Detail>}
      <UplinkSkewOverride outcome={outcome} />
      {outcome.status === "quarantined" &&
        outcome.reason === "consent declined" &&
        outcome.version && (
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              revokeConsent(outcome.id, outcome.version as string);
              window.location.reload();
            }}
          >
            Reconsider
          </Button>
        )}
    </StatusItem>
  );
}

/** Whether a page's health or client asks for the operator's attention. */
export function statusNeedsAttention(
  entry: UplinkHealthEntry | undefined,
  outcome: UplinkLoadOutcome | undefined,
): boolean {
  if (entry !== undefined && entry.health.state !== "healthy") return true;
  return outcome?.status === "quarantined";
}

const healthColor: Record<UplinkHealthStateName, string> = {
  healthy: "var(--color-accent-fg)",
  degraded: "var(--color-warn-mark)",
  unavailable: "var(--color-nogo-mark)",
};

const loaderColor: Record<UplinkLoadStatus, string> = {
  loading: "var(--color-warn-mark)",
  loaded: "var(--color-accent-fg)",
  quarantined: "var(--color-nogo-mark)",
};

export const StatusList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const StatusItem = styled.li`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const Version = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  white-space: nowrap;
`;

const Indicator = styled.span<{ $color: string }>`
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  flex-shrink: 0;
  background: ${({ $color }) => $color};
`;

const StatusLabel = styled.span<{ $color: string }>`
  font-size: var(--font-size-caption);
  color: ${({ $color }) => $color};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const Detail = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-dim);
  margin-left: var(--indent-settings);
  /* A self-reported detail can be long or carry line breaks, so it wraps in full rather than truncating. */
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: var(--line-height-body);
`;

const Facts = styled.dl`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--gap-readout-row) var(--gap-label-value);
  margin: 0 0 0 var(--indent-settings);
  font-size: var(--font-size-compact);
`;

const FactLabel = styled.dt`
  color: var(--color-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
`;

const FactValue = styled.dd`
  margin: 0;
  color: var(--color-text-dim);
  /* A path or a hash has no spaces to wrap at and would otherwise push the modal wide. */
  overflow-wrap: anywhere;
`;
