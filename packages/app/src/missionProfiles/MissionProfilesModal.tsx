import { value } from "@ksp-gonogo/sitrep-sdk";
import { Button, FilterChip, Input, Switch } from "@ksp-gonogo/ui";
import {
  LiveRegion,
  SectionTitle,
  Stack,
  Tooltip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import styled from "styled-components";
import {
  DEFAULT_TEMPLATES,
  type LayoutTemplate,
  snapshotOf,
} from "./layoutTemplates";
import {
  useMissionProfiles,
  useMissionProfilesService,
} from "./MissionProfilesContext";
import {
  BINDABLE_SCENES,
  type BindableScene,
  type MissionProfile,
  SCENE_LABELS,
} from "./MissionProfilesService";
import type { ProfileDashboard } from "./ProfileDashboard";
import { ProfileInputSlot } from "./ProfileInputSlot";
import { useHistoryState } from "./useProfileDashboard";

/** What a new layout starts from: nothing, the dashboard on screen, or a starter. */
type NewSource = "empty" | "current" | `template:${string}`;

function templateFor(source: NewSource): LayoutTemplate | undefined {
  return DEFAULT_TEMPLATES.find((t) => `template:${t.name}` === source);
}

interface MissionProfilesModalProps {
  /** The dashboard the layouts belong to: switched, copied and undone from here. */
  dashboard: ProfileDashboard;
  /** Closes the modal. */
  onClose?: () => void;
}

/**
 * Mission Profiles: named dashboards. Every change to the dashboard saves
 * into the current layout; a layout can be copied under a new name and
 * switched to later. Useful for "Launch → Orbit → Rendezvous" flows where the
 * optimal widget set changes sharply between mission phases.
 */
export function MissionProfilesModal({
  dashboard,
  onClose,
}: Readonly<MissionProfilesModalProps>) {
  const svc = useMissionProfilesService();
  const profiles = useMissionProfiles();
  const currentId = svc.getCurrentId();
  const { canUndo, canRedo } = useHistoryState(dashboard);
  const [newName, setNewName] = useState("");
  const [newSource, setNewSource] = useState<NewSource>("empty");
  const [newBindings, setNewBindings] = useState<BindableScene[]>([]);
  const [newAutoSwitch, setNewAutoSwitch] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MissionProfile | null>(
    null,
  );
  const [editingScenesId, setEditingScenesId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [inputNotice, setInputNotice] = useState<string | null>(null);

  const chooseSource = (source: NewSource) => {
    setNewSource(source);
    const template = templateFor(source);
    if (!template) return;
    // A starter brings the scenes it is meant for; both stay editable.
    setNewBindings([...template.scenes]);
    setNewAutoSwitch(true);
    if (!newName.trim() || DEFAULT_TEMPLATES.some((t) => t.name === newName)) {
      setNewName(template.name);
    }
  };

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const scenes = newBindings;
    const auto = newBindings.length > 0 && newAutoSwitch;
    if (newSource === "current") {
      dashboard.saveAs(trimmed, scenes, auto);
    } else {
      const template = templateFor(newSource);
      dashboard.createLayout(
        trimmed,
        template ? snapshotOf(template) : undefined,
        scenes,
        auto,
      );
    }
    setNewName("");
    setNewSource("empty");
    setNewBindings([]);
    setNewAutoSwitch(false);
  };

  const toggleBindingFor = (profile: MissionProfile, scene: BindableScene) => {
    const current = profile.sceneBindings ?? [];
    const next = current.includes(scene)
      ? current.filter((s) => s !== scene)
      : [...current, scene];
    // When bindings clear out, auto-switch becomes meaningless, drop it.
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
    dashboard.switchTo(profile.id);
    onClose?.();
  };

  const handleDuplicate = (profile: MissionProfile) => {
    dashboard.duplicate(profile.id);
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

  // Extracted to keep the JSX readable: a row is either confirming a delete
  // or showing its ordinary actions.
  function renderRowActions(p: MissionProfile): React.ReactNode {
    if (pendingDelete?.id === p.id) {
      return (
        <>
          <ConfirmText role="alert">
            {p.id === currentId
              ? `Delete ${p.name}? The dashboard stays as it is.`
              : `Delete ${p.name}?`}
          </ConfirmText>
          <Button
            variant="ghost"
            type="button"
            onClick={() => setPendingDelete(null)}
          >
            Cancel
          </Button>
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
        <Tooltip text="Make this the layout the dashboard shows and saves into">
          <Button
            type="button"
            disabled={p.id === currentId}
            onClick={() => handleLoad(p)}
          >
            Switch to
          </Button>
        </Tooltip>
        <Button
          variant="ghost"
          type="button"
          onClick={() => handleDuplicate(p)}
        >
          Duplicate
        </Button>
        <Button
          variant="ghost"
          type="button"
          onClick={() => handleRenameStart(p)}
        >
          Rename
        </Button>
        <Button
          variant="ghost"
          tone="nogo"
          type="button"
          onClick={() => setPendingDelete(p)}
        >
          Delete
        </Button>
      </>
    );
  }

  return (
    <Wrap>
      <Stack as="section" gap="related-comfortable">
        <SectionTitle as="h3" $rule>
          Current layout
        </SectionTitle>
        <CurrentRow>
          <ProfileName>
            {profiles.find((p) => p.id === currentId)?.name ?? "No layout yet"}
          </ProfileName>
          <Button
            type="button"
            variant="ghost"
            disabled={!canUndo}
            onClick={() => dashboard.undo()}
          >
            Undo
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!canRedo}
            onClick={() => dashboard.redo()}
          >
            Redo
          </Button>
        </CurrentRow>
        <Hint>
          Every change to the dashboard saves into the current layout. Undo and
          Redo step back through changes and layout switches.
        </Hint>
        <SectionTitle as="h3" $rule>
          New layout
        </SectionTitle>
        <SaveRow>
          <Input
            type="text"
            value={newName}
            aria-label="Layout name"
            placeholder="e.g. Launch, Orbit, Rendezvous"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          <CreateButton
            variant="primary"
            type="button"
            onClick={handleCreate}
            disabled={!newName.trim()}
          >
            Create layout
          </CreateButton>
        </SaveRow>
        <BindingsField role="group" aria-label="Start from">
          <BindingsLabel>Start from</BindingsLabel>
          <BindingsRow>
            <FilterChip
              label="Empty"
              selected={newSource === "empty"}
              onToggle={() => chooseSource("empty")}
            />
            <FilterChip
              label="This dashboard"
              selected={newSource === "current"}
              onToggle={() => chooseSource("current")}
            />
            {DEFAULT_TEMPLATES.map((t) => (
              <FilterChip
                key={t.name}
                label={`${t.name} starter`}
                selected={newSource === `template:${t.name}`}
                onToggle={() => chooseSource(`template:${t.name}`)}
              />
            ))}
          </BindingsRow>
        </BindingsField>
        <BindingsField>
          <BindingsLabel>Offer this layout when entering</BindingsLabel>
          <BindingsRow>
            {BINDABLE_SCENES.map((scene) => (
              <FilterChip
                key={scene}
                label={SCENE_LABELS[scene]}
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
          <Tooltip
            text={
              newBindings.length === 0
                ? "Pick at least one scene to enable auto-switch"
                : "Skip the prompt and load this layout immediately on a matching scene"
            }
            focusable
          >
            <AutoSwitchRow $disabled={newBindings.length === 0}>
              <Switch
                checked={newBindings.length > 0 && newAutoSwitch}
                onChange={(v) => setNewAutoSwitch(v)}
                label="Switch automatically"
              />
            </AutoSwitchRow>
          </Tooltip>
        </BindingsField>
        <Hint>
          The new layout opens straight away. A layout can follow several
          scenes: tagged scenes show a switch prompt at the bottom of the screen
          when KSP enters that scene, or switch straight away if "Switch
          automatically" is on.
        </Hint>
      </Stack>

      <Stack as="section" gap="related-comfortable">
        <SectionTitle as="h3" $rule>
          All layouts
        </SectionTitle>
        <InputNotice>{inputNotice}</InputNotice>
        {profiles.length === 0 ? (
          <Empty>No layouts yet for this screen</Empty>
        ) : (
          <List>
            {profiles.map((p) => (
              <ProfileRow key={p.id}>
                <ProfileHeader>
                  {renamingId === p.id ? (
                    <Input
                      type="text"
                      value={renameDraft}
                      aria-label={`Rename ${p.name}`}
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
                    {p.id === currentId ? "Current · " : ""}
                    {p.draft ? "Unnamed · " : ""}
                    {p.items.length} widget{p.items.length === 1 ? "" : "s"} ·{" "}
                    <Unit value={value("irl:s", ageSeconds(p.updatedAt))} /> ago
                  </ProfileMeta>
                </ProfileHeader>
                <ProfileActions>{renderRowActions(p)}</ProfileActions>
                <ProfileInputSlot profile={p} onNotice={setInputNotice} />
                <BindingsRow>
                  <BindingsLabel>
                    {boundScenesText(p.sceneBindings)}
                  </BindingsLabel>
                  <Tooltip text="Choose which game scenes offer this layout">
                    <Button
                      variant="ghost"
                      type="button"
                      aria-expanded={editingScenesId === p.id}
                      onClick={() =>
                        setEditingScenesId(
                          editingScenesId === p.id ? null : p.id,
                        )
                      }
                    >
                      {editingScenesId === p.id ? "Done" : "Change scenes"}
                    </Button>
                  </Tooltip>
                </BindingsRow>
                {editingScenesId === p.id && (
                  <BindingsRow>
                    {BINDABLE_SCENES.map((scene) => (
                      <FilterChip
                        key={scene}
                        label={SCENE_LABELS[scene]}
                        selected={p.sceneBindings?.includes(scene) ?? false}
                        onToggle={() => toggleBindingFor(p, scene)}
                      />
                    ))}
                  </BindingsRow>
                )}
                <Tooltip
                  text={
                    (p.sceneBindings?.length ?? 0) === 0
                      ? "Tag at least one scene to enable auto-switch"
                      : "Skip the prompt and load this layout immediately on a matching scene"
                  }
                  focusable
                >
                  <AutoSwitchRow
                    $disabled={(p.sceneBindings?.length ?? 0) === 0}
                  >
                    <Switch
                      checked={Boolean(p.autoSwitch)}
                      onChange={() => toggleAutoSwitchFor(p)}
                      label="Switch automatically"
                    />
                  </AutoSwitchRow>
                </Tooltip>
              </ProfileRow>
            ))}
          </List>
        )}
      </Stack>
    </Wrap>
  );
}

function boundScenesText(bindings: readonly BindableScene[] | undefined) {
  const bound = BINDABLE_SCENES.filter((s) => bindings?.includes(s));
  return bound.length === 0
    ? "Not offered in any scene"
    : `Offered in: ${bound.map((s) => SCENE_LABELS[s]).join(", ")}`;
}

/**
 * How long ago a profile was written, in wall-clock seconds.
 *
 * The caller renders this as `irl:s` rather than `s`, because `updatedAt` is a
 * `Date.now()` stamp and so counts the operator's afternoon rather than
 * Kerbin's rotation. Laddered as game time it ran on a six-hour day, and a
 * profile saved yesterday read as "4d".
 */
function ageSeconds(ts: number): number {
  return Math.max(0, Math.round((Date.now() - ts) / 1000));
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  min-width: 420px;
`;

const InputNotice = styled(LiveRegion)`
  display: block;
  font-size: var(--font-size-compact);
  color: var(--color-info-text);
`;

const CurrentRow = styled.div`
  display: flex;
  gap: var(--gap-related);
  align-items: center;
`;

const SaveRow = styled.div`
  display: flex;
  gap: var(--gap-related);
  align-items: stretch;
`;

const ConfirmText = styled.span`
  align-self: center;
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
`;

const Hint = styled.p`
  margin: 0;
  font-size: var(--font-size-compact);
  color: var(--color-text-dim);
`;

const Empty = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-compact);
  padding: var(--inset-empty-note);
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const ProfileRow = styled.div`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
  padding: var(--inset-surface);
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const ProfileHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--gap-related);
`;

const ProfileName = styled.span`
  font-size: var(--font-size-value);
  color: var(--color-text-primary);
  font-weight: 600;
`;

const ProfileMeta = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
`;

const ProfileActions = styled.div`
  display: flex;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

const CreateButton = styled(Button)`
  flex-shrink: 0;
  white-space: nowrap;
`;

const DangerButton = styled(Button)`
  background: var(--color-nogo-muted);
  border-color: var(--color-nogo-mark);
  color: var(--color-nogo-text);
`;

const BindingsField = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const BindingsLabel = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
`;

const BindingsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-related);
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
