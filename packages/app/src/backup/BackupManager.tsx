import {
  Button,
  Field,
  FieldHint,
  FieldLabel,
  FileInput,
  PrimaryButton,
  Switch,
} from "@ksp-gonogo/ui";
import { type ChangeEvent, useId, useRef, useState } from "react";
import styled from "styled-components";
import {
  BackupValidationError,
  exportAsFile,
  importFromFile,
} from "./BackupService";

type ImportPhase = "idle" | "confirming" | "applying";

/**
 * Settings panel for backing up and restoring the device's local state.
 *
 * Export writes a versioned JSON file of all gonogo localStorage keys (device
 * identity excluded unless the operator opts in). Import is REPLACE-only: it
 * overwrites each key in the file, then reloads the page so every service
 * re-reads the restored state — without the reload the imported config would
 * sit inert until the next page load.
 */
export function BackupManager() {
  const [includeIdentity, setIncludeIdentity] = useState(false);

  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importId = useId();

  function resetImport() {
    setPhase("idle");
    setPendingFile(null);
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setImportError(null);
    setPendingFile(file);
    setPhase(file ? "confirming" : "idle");
  }

  async function handleConfirmImport() {
    if (!pendingFile) return;
    setPhase("applying");
    setImportError(null);
    try {
      await importFromFile(pendingFile);
      // Load-bearing: services (analytics consent, datasource configs, station
      // identity) only read localStorage at boot, so the restored state is
      // inert until a reload re-runs that boot path.
      window.location.reload();
    } catch (err) {
      const message =
        err instanceof BackupValidationError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not read the backup file.";
      setImportError(message);
      setPhase("confirming");
    }
  }

  return (
    <Container>
      <Section>
        <SectionTitle>Export</SectionTitle>
        <Foot>
          Downloads a JSON file of this device's dashboard layouts, data-source
          configs, devices, alarms, notes and settings. Restore it on another
          screen or after a reset.
        </Foot>
        <Field>
          <IdentityRow>
            <Switch
              checked={includeIdentity}
              onChange={setIncludeIdentity}
              label="Include device identity"
            />
            <FieldHint>
              Carries this station's identity (its key &amp; peer id) into the
              backup. Leave off unless you're cloning this exact station —
              restoring identity onto another device makes two stations claim
              the same id.
            </FieldHint>
          </IdentityRow>
        </Field>
        <ActionRow>
          <Button onClick={() => exportAsFile({ includeIdentity })}>
            Export backup
          </Button>
        </ActionRow>
      </Section>

      <Section>
        <SectionTitle>Restore</SectionTitle>
        <Foot>
          Restoring <strong>replaces</strong> your current layouts and settings
          with those in the file, then reloads the app. This can't be undone —
          export a backup first if you want to keep the current state.
        </Foot>
        <Field>
          <FieldLabel htmlFor={importId}>Backup file</FieldLabel>
          <FileInput
            id={importId}
            ref={fileInputRef}
            accept="application/json,.json"
            fileName={pendingFile?.name ?? null}
            onChange={handleFileChange}
            label="Choose backup"
          />
        </Field>
        {importError && <Warn role="alert">{importError}</Warn>}
        {phase === "confirming" || phase === "applying" ? (
          <ConfirmRow role="group" aria-label="Confirm restore">
            <ConfirmText>
              Replace all current settings with{" "}
              <strong>{pendingFile?.name}</strong> and reload?
            </ConfirmText>
            <PrimaryButton
              type="button"
              onClick={handleConfirmImport}
              disabled={phase === "applying"}
            >
              {phase === "applying" ? "Restoring..." : "Replace & reload"}
            </PrimaryButton>
            <Button
              type="button"
              onClick={resetImport}
              disabled={phase === "applying"}
            >
              Cancel
            </Button>
          </ConfirmRow>
        ) : null}
      </Section>
    </Container>
  );
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 420px;
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const Foot = styled.div`
  color: var(--color-text-dim);
  font-size: 11px;
`;

const IdentityRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ActionRow = styled.div`
  display: flex;
  gap: 8px;
`;

const ConfirmRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--color-border-strong);
  border-radius: 3px;
  background: var(--color-surface-raised);
`;

const ConfirmText = styled.span`
  margin-right: auto;
  font-size: 12px;
  color: var(--color-text-primary);
`;

const Warn = styled.span`
  color: var(--color-status-warning-bg);
  font-size: 11px;
`;
