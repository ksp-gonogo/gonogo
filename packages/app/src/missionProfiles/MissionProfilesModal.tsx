import {
  Button,
  FilterChip,
  GhostButton,
  Input,
  PrimaryButton,
  Switch,
} from "@gonogo/ui";
import { useState } from "react";
import type { Layouts } from "react-grid-layout";
import styled from "styled-components";
import type { DashboardItem } from "../components/Dashboard";
import {
  useMissionProfiles,
  useMissionProfilesService,
} from "./MissionProfilesContext";
import {
  BINDABLE_SCENES,
  type BindableScene,
  type MissionProfile,
} from "./MissionProfilesService";

interface MissionProfilesModalProps {
  /** Current dashboard state — used for the "save current as…" button. */
  currentItems: DashboardItem[];
  currentLayouts: Layouts;
  /** Called when the user loads a profile. */
  onLoad: (profile: MissionProfile) => void;
  /** Closes the modal. */
  onClose?: () => void;
}

/**
 * Mission Profiles — named dashboard snapshots. Capture the current
 * layout with a name and reload it later; useful for "Launch → Orbit →
 * Rendezvous" flows where the optimal widget set changes sharply
 * between mission phases.
 */
export function MissionProfilesModal({
  currentItems,
  currentLayouts,
  onLoad,
  onClose,
}: Readonly<MissionProfilesModalProps>) {
  const svc = useMissionProfilesService();
  const profiles = useMissionProfiles();
  const [newName, setNewName] = useState("");
  const [newBindings, setNewBindings] = useState<BindableScene[]>([]);
  const [newAutoSwitch, setNewAutoSwitch] = useState(false);
  const [pendingLoad, setPendingLoad] = useState<MissionProfile | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MissionProfile | null>(
    null,
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const handleSaveCurrent = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    svc.save(
      trimmed,
      currentItems,
      currentLayouts,
      newBindings,
      newBindings.length > 0 && newAutoSwitch,
    );
    setNewName("");
    setNewBindings([]);
    setNewAutoSwitch(false);
  };

  const toggleBindingFor = (profile: MissionProfile, scene: BindableScene) => {
    const current = profile.sceneBindings ?? [];
    const next = current.includes(scene)
      ? current.filter((s) => s !== scene)
      : [...current, scene];
    // When bindings clear out, auto-switch becomes meaningless — drop it.
    const nextAutoSwitch = next.length === 0 ? false : profile.autoSwitch;
    svc.update(profile.id, {
      sceneBindings: next,
      autoSwitch: nextAutoSwitch,
    });
  };

  const toggleAutoSwitchFor = (profile: MissionProfile) => {
    svc.update(profile.id, { autoSwitch: !profile.autoSwitch });
  };

  const handleLoad = (profile: MissionProfile) => {
    onLoad(profile);
    onClose?.();
  };

  const handleOverwrite = (profile: MissionProfile) => {
    svc.update(profile.id, {
      items: currentItems,
      layouts: currentLayouts,
    });
  };

  const handleDelete = (profile: MissionProfile) => {
    svc.remove(profile.id);
  };

  const handleRenameStart = (profile: MissionProfile) => {
    setRenamingId(profile.id);
    setRenameDraft(profile.name);
  };

  const handleRenameCommit = (profile: MissionProfile) => {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== profile.name) {
      svc.update(profile.id, { name: trimmed });
    }
    setRenamingId(null);
    setRenameDraft("");
  };

  // Extracted to avoid a triple-nested ternary inside the JSX — each row is
  // in exactly one of three states (confirming-load, confirming-delete, or
  // default), and splitting it out keeps the render tree readable.
  function renderRowActions(p: MissionProfile): React.ReactNode {
    if (pendingLoad?.id === p.id) {
      return (
        <>
          <GhostButton type="button" onClick={() => setPendingLoad(null)}>
            Cancel
          </GhostButton>
          <PrimaryButton
            type="button"
            onClick={() => {
              setPendingLoad(null);
              handleLoad(p);
            }}
          >
            Confirm load
          </PrimaryButton>
        </>
      );
    }
    if (pendingDelete?.id === p.id) {
      return (
        <>
          <GhostButton type="button" onClick={() => setPendingDelete(null)}>
            Cancel
          </GhostButton>
          <DangerButton
            type="button"
            onClick={() => {
              setPendingDelete(null);
              handleDelete(p);
            }}
          >
            Delete
          </DangerButton>
        </>
      );
    }
    return (
      <>
        <Button
          type="button"
          onClick={() => setPendingLoad(p)}
          title="Replace the current dashboard with this profile"
        >
          Load
        </Button>
        <GhostButton
          type="button"
          onClick={() => handleOverwrite(p)}
          title="Overwrite this profile with the current dashboard"
        >
          Overwrite
        </GhostButton>
        <GhostButton type="button" onClick={() => handleRenameStart(p)}>
          Rename
        </GhostButton>
        <GhostButton type="button" onClick={() => setPendingDelete(p)}>
          Delete
        </GhostButton>
      </>
    );
  }

  return (
    <Wrap>
      <Section>
        <SectionTitle>Save current dashboard</SectionTitle>
        <SaveRow>
          <Input
            type="text"
            value={newName}
            placeholder="e.g. Launch, Orbit, Rendezvous"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveCurrent();
            }}
          />
          <PrimaryButton
            type="button"
            onClick={handleSaveCurrent}
            disabled={!newName.trim()}
          >
            Save
          </PrimaryButton>
        </SaveRow>
        <BindingsField>
          <BindingsLabel>Auto-prompt when scene is</BindingsLabel>
          <BindingsRow>
            {BINDABLE_SCENES.map((scene) => (
              <FilterChip
                key={scene}
                label={scene}
                selected={newBindings.includes(scene)}
                onToggle={() =>
                  setNewBindings((prev) =>
                    prev.includes(scene)
                      ? prev.filter((s) => s !== scene)
                      : [...prev, scene],
                  )
                }
              />
            ))}
          </BindingsRow>
          <AutoSwitchRow
            $disabled={newBindings.length === 0}
            title={
              newBindings.length === 0
                ? "Pick at least one scene to enable auto-switch"
                : "Skip the prompt and load this profile immediately on a matching scene"
            }
          >
            <Switch
              checked={newBindings.length > 0 && newAutoSwitch}
              onChange={(v) => setNewAutoSwitch(v)}
              label="Switch automatically"
            />
          </AutoSwitchRow>
        </BindingsField>
        <Hint>
          Captures the current widget layout. Load it back later to swap the
          whole dashboard at once. Tagged scenes show a load prompt at the
          bottom of the screen when KSP enters that scene — or auto-load if
          "Switch automatically" is on.
        </Hint>
      </Section>

      <Section>
        <SectionTitle>Saved profiles</SectionTitle>
        {profiles.length === 0 ? (
          <Empty>No saved profiles yet for this screen.</Empty>
        ) : (
          <List>
            {profiles.map((p) => (
              <ProfileRow key={p.id}>
                <ProfileHeader>
                  {renamingId === p.id ? (
                    <Input
                      type="text"
                      value={renameDraft}
                      autoFocus
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => handleRenameCommit(p)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameCommit(p);
                        if (e.key === "Escape") {
                          setRenamingId(null);
                          setRenameDraft("");
                        }
                      }}
                    />
                  ) : (
                    <ProfileName>{p.name}</ProfileName>
                  )}
                  <ProfileMeta>
                    {p.items.length} widget{p.items.length === 1 ? "" : "s"} ·{" "}
                    {formatRelative(p.updatedAt)}
                  </ProfileMeta>
                </ProfileHeader>
                <ProfileActions>{renderRowActions(p)}</ProfileActions>
                <BindingsRow>
                  {BINDABLE_SCENES.map((scene) => (
                    <FilterChip
                      key={scene}
                      label={scene}
                      selected={p.sceneBindings?.includes(scene) ?? false}
                      onToggle={() => toggleBindingFor(p, scene)}
                    />
                  ))}
                </BindingsRow>
                <AutoSwitchRow
                  $disabled={(p.sceneBindings?.length ?? 0) === 0}
                  title={
                    (p.sceneBindings?.length ?? 0) === 0
                      ? "Tag at least one scene to enable auto-switch"
                      : "Skip the prompt and load this profile immediately on a matching scene"
                  }
                >
                  <Switch
                    checked={Boolean(p.autoSwitch)}
                    onChange={() => toggleAutoSwitchFor(p)}
                    label="Switch automatically"
                  />
                </AutoSwitchRow>
                {pendingLoad?.id === p.id && (
                  <Warning role="alert">
                    Loading will replace the current dashboard with{" "}
                    <b>{p.name}</b>. Unsaved changes will be lost unless you
                    save them as a profile first.
                  </Warning>
                )}
              </ProfileRow>
            ))}
          </List>
        )}
      </Section>
    </Wrap>
  );
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 420px;
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--color-border-subtle);
`;

const SaveRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: stretch;
`;

const Hint = styled.p`
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-dim);
`;

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-sm);
  padding: 8px 0;
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ProfileRow = styled.div`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ProfileHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
`;

const ProfileName = styled.span`
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
  font-weight: 600;
`;

const ProfileMeta = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-faint);
`;

const ProfileActions = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`;

const DangerButton = styled(Button)`
  background: var(--color-status-alert-muted);
  border-color: var(--color-status-nogo-bg);
  color: var(--color-status-nogo-fg);
`;

const Warning = styled.div`
  background: var(--color-status-alert-muted);
  border: 1px solid var(--color-status-alert-muted);
  border-radius: 2px;
  padding: 6px 10px;
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-sm);
`;

const BindingsField = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const BindingsLabel = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
`;

const BindingsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const AutoSwitchRow = styled.div<{ $disabled: boolean }>`
  display: flex;
  align-items: center;
  /* The Switch primitive provides its own visual state; when bindings
     are empty we dim the whole row + intercept pointer events with
     pointer-events:none so the toggle reads as inert without needing
     a new disabled mode on Switch. */
  opacity: ${({ $disabled }) => ($disabled ? 0.4 : 1)};
  pointer-events: ${({ $disabled }) => ($disabled ? "none" : "auto")};
`;
