import { useFogMaskStore } from "@gonogo/data";
import { Button, IconButton, Input, PrimaryButton } from "@gonogo/ui";
import { useState } from "react";
import styled from "styled-components";
import {
  useActiveProfile,
  useSaveProfileService,
  useSaveProfiles,
} from "./SaveProfileContext";
import type { SaveProfile } from "./SaveProfileService";

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Row = styled.li<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid ${({ $active }) => ($active ? "var(--color-status-go-bg)" : "var(--color-border-subtle)")};
  background: ${({ $active }) =>
    $active ? "rgba(40, 120, 60, 0.1)" : "rgba(26, 26, 26, 0.6)"};
  border-radius: 3px;
`;

const Name = styled.div`
  flex: 1;
  font-size: 13px;
  color: var(--color-text-primary);
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Meta = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-dim);
  letter-spacing: 0.05em;
`;

const Actions = styled.div`
  display: flex;
  gap: 4px;
`;

const ScopeNote = styled.div`
  font-size: var(--font-size-xs);
  color: var(--color-status-go-bg); /* teal — subtle call-out that scope is narrow */
  letter-spacing: 0.05em;
  padding: 6px 0 10px;
  border-bottom: 1px solid var(--color-border-subtle);
  margin-bottom: 8px;
`;

const NewRow = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 12px;
`;

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}

function ProfileRow({
  profile,
  isActive,
  onActivate,
  onRename,
  onDelete,
}: {
  profile: SaveProfile;
  isActive: boolean;
  onActivate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(profile.name);

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== profile.name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <Row $active={isActive}>
      <Name>
        {editing ? (
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraftName(profile.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          profile.name
        )}
        <Meta>
          Created {formatDate(profile.createdAt)} · last played{" "}
          {formatDate(profile.lastPlayed)}
        </Meta>
      </Name>
      <Actions>
        {!isActive && <Button onClick={onActivate}>Switch</Button>}
        {!editing && (
          <IconButton
            title="Rename"
            onClick={() => {
              setDraftName(profile.name);
              setEditing(true);
            }}
          >
            rename
          </IconButton>
        )}
        <IconButton
          title="Delete"
          onClick={() => {
            if (
              confirm(
                `Delete profile "${profile.name}"? Map data will be erased.`,
              )
            ) {
              onDelete();
            }
          }}
        >
          delete
        </IconButton>
      </Actions>
    </Row>
  );
}

export function SaveProfilesManager() {
  const service = useSaveProfileService();
  const fogStore = useFogMaskStore();
  const profiles = useSaveProfiles();
  const active = useActiveProfile();
  const [newName, setNewName] = useState("");

  const createNew = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const created = service.create(trimmed);
    service.setActive(created.id);
    setNewName("");
  };

  const handleDelete = (profileId: string) => {
    service.remove(profileId);
    // Best-effort cleanup. Orphaned masks aren't harmful, but this reclaims
    // IndexedDB space and prevents stale data bleeding into a new profile
    // that happens to reuse the id.
    void fogStore?.clearProfile(profileId);
  };

  return (
    <div>
      <ScopeNote>Currently scopes: map exploration only.</ScopeNote>
      <List>
        {profiles.map((p) => (
          <ProfileRow
            key={p.id}
            profile={p}
            isActive={p.id === active.id}
            onActivate={() => service.setActive(p.id)}
            onRename={(name) => service.rename(p.id, name)}
            onDelete={() => handleDelete(p.id)}
          />
        ))}
      </List>
      <NewRow>
        <Input
          placeholder="New profile name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") createNew();
          }}
        />
        <PrimaryButton onClick={createNew} disabled={!newName.trim()}>
          Create
        </PrimaryButton>
      </NewRow>
    </div>
  );
}
