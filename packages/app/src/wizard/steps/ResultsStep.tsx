import {
  Badge,
  EmptyState,
  PrimaryButton,
  Spinner,
  StatusIndicator,
} from "@ksp-gonogo/ui";
import { Stack } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import styled, { useTheme } from "styled-components";
import { ConnectionRow, Name } from "../../settings/SitrepConnection";
import { setConsentPrompt } from "../../uplinks/consent";
import { promptForConsent } from "../../uplinks/consentModal";
import { hostCompat } from "../../uplinks/hostCompat";
import { type LoaderContext, loadUplinkById } from "../../uplinks/loader";
import { hubRegistrySource } from "../../uplinks/registry";
import { VERSION } from "../../version";
import { type UplinkGapEntry, useUplinkGap } from "../useUplinkGap";

/**
 * Results step (design §3 steps 5-7) — calls `useUplinkGap()` and renders one
 * row per entry, the row's affordance a pure function of `entry.state`. The
 * Load action (`load-from-hub` rows) runs `loadUplinkById` and never mutates
 * local state on success: `useUplinkGap` already re-subscribes to
 * `loaderState` via `useSyncExternalStore`, so a `setUplinkOutcome({status:
 * "loaded"})` call inside `loadUplinkById` flips the row on its own — the
 * local `pendingId`/`loadErrors` state here exists only for the in-flight
 * spinner and a failure's reason, neither of which `loaderState` surfaces
 * for a `quarantined` outcome (only `loaded` outcomes feed `useUplinkGap`'s
 * `loadedIds`).
 */
export function ResultsStep() {
  const { entries, loading, error } = useUplinkGap();
  const theme = useTheme();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});

  async function handleLoad(id: string): Promise<void> {
    setPendingId(id);
    setLoadErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

    // Wire the real, themed consent modal just-in-time. `main.tsx` only
    // wires `setConsentPrompt` inside the runtime-loader-flag branch, so a
    // wizard-triggered load under the shipped default (flag off) would
    // otherwise fall back to the unwired "always deny" default in
    // `consent.ts`. This call is idempotent and safe to repeat per click.
    setConsentPrompt((info) => promptForConsent(info, theme));

    const ctx: LoaderContext = {
      registrySource: hubRegistrySource(),
      enabledIds: [id],
      hostCompat,
      appVersion: VERSION,
    };

    const outcome = await loadUplinkById(id, ctx);
    setPendingId(null);
    if (outcome.status === "quarantined") {
      setLoadErrors((prev) => ({
        ...prev,
        [id]: outcome.reason ?? "load failed",
      }));
    }
  }

  if (loading) {
    return (
      <LoadingRow role="status">
        <Spinner ariaLabel="Checking installed Uplinks" />
        <span>Checking installed Uplinks…</span>
      </LoadingRow>
    );
  }

  return (
    <Stack gap="sm">
      {error && (
        <StatusIndicator tone="warn" live>
          Hub unavailable: {error}
        </StatusIndicator>
      )}
      {entries.length === 0 ? (
        <EmptyState>No Uplinks reported by the mod yet.</EmptyState>
      ) : (
        <RowList>
          {entries.map((entry) => (
            <UplinkRow
              key={entry.id}
              entry={entry}
              pending={pendingId === entry.id}
              loadError={loadErrors[entry.id]}
              onLoad={() => void handleLoad(entry.id)}
            />
          ))}
        </RowList>
      )}
    </Stack>
  );
}

function UplinkRow({
  entry,
  pending,
  loadError,
  onLoad,
}: Readonly<{
  entry: UplinkGapEntry;
  pending: boolean;
  loadError: string | undefined;
  onLoad: () => void;
}>) {
  return (
    <RowItem>
      <ConnectionRow>
        <Name>{entry.name}</Name>
        <RowAffordance entry={entry} pending={pending} onLoad={onLoad} />
      </ConnectionRow>
      {loadError && (
        <RowDetail role="status" aria-live="polite">
          {loadError}
        </RowDetail>
      )}
    </RowItem>
  );
}

function RowAffordance({
  entry,
  pending,
  onLoad,
}: Readonly<{
  entry: UplinkGapEntry;
  pending: boolean;
  onLoad: () => void;
}>) {
  switch (entry.state) {
    case "loaded":
      return <Badge tone="go">Loaded</Badge>;
    case "load-from-hub":
      return (
        <PrimaryButton
          type="button"
          onClick={onLoad}
          disabled={pending}
          aria-label={`Load ${entry.name}`}
        >
          {pending ? "Loading…" : "Load"}
        </PrimaryButton>
      );
    case "installed-no-client":
      return (
        <StatusIndicator tone="neutral">
          Installed in KSP, no downloadable client
        </StatusIndicator>
      );
    case "unavailable":
      return (
        <StatusIndicator tone="nogo">
          {entry.modReason ?? "Unavailable"}
        </StatusIndicator>
      );
    case "hub-unknown":
      return (
        <StatusIndicator tone="warn">Couldn't reach the Hub</StatusIndicator>
      );
    default:
      return null;
  }
}

const LoadingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sm);
  color: var(--color-text-dim);
  padding: 8px 0;
`;

const RowList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const RowItem = styled.li`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const RowDetail = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-dim);
  margin-left: 16px;
`;
