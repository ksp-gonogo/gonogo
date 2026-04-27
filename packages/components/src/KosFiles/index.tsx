import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import { logger, registerComponent } from "@gonogo/core";
import { useKosWidget } from "@gonogo/data";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  PrimaryButton,
} from "@gonogo/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { KosScriptFrame } from "../kos/KosScriptFrame";
import {
  type KosFileEntry,
  KOS_FILES_SCRIPT,
  KOS_FILES_SCRIPT_NAME,
  MAX_VIEW_CHARS,
} from "./filesScript";

interface KosFilesConfig {
  /** kOS CPU tagname this widget runs the dispatcher script on. */
  cpu?: string;
  /** Path of the saved kerboscript on the kOS Archive volume. */
  scriptName?: string;
  /** Volume root passed to the dispatcher — "0:", "Archive", etc. */
  volume?: string;
}

const DEFAULT_VOLUME = "0:";

type ViewMode =
  | { kind: "list"; path: string }
  | { kind: "view"; path: string };

function KosFilesComponent({
  config,
}: Readonly<ComponentProps<KosFilesConfig>>) {
  const cpu = config?.cpu ?? "";
  const scriptName = config?.scriptName ?? KOS_FILES_SCRIPT_NAME;
  const volume = config?.volume ?? DEFAULT_VOLUME;

  const [view, setView] = useState<ViewMode>({ kind: "list", path: volume });

  // Resync if the configured volume changes.
  useEffect(() => {
    setView({ kind: "list", path: volume });
  }, [volume]);

  // Args derive from current view — kOS-side script's PARAMETER signature
  // is (op, pathArg). Listing uses the current directory; reading uses a
  // full path.
  const args = useMemo(() => {
    if (view.kind === "list") {
      return [
        { type: "string" as const, value: "list" },
        { type: "string" as const, value: view.path },
      ];
    }
    return [
      { type: "string" as const, value: "read" },
      { type: "string" as const, value: view.path },
    ];
  }, [view]);

  const { data, error, running, lastGoodAt, dispatch } = useKosWidget({
    cpu,
    script: scriptName,
    args,
    mode: "command",
  });

  // Re-dispatch whenever the view (and therefore args) changes — useKosWidget
  // doesn't auto-trigger on arg change, so we kick it ourselves.
  useEffect(() => {
    if (!cpu) return;
    dispatch();
    // dispatch is stable per source; view changes drive the actual reload.
  }, [view, cpu, dispatch]);

  useEffect(() => {
    if (!data) return;
    logger.info("kos-files: payload received", {
      op: data.op,
      keys: Object.keys(data),
    });
  }, [data]);

  const { listing, contents, payloadError, parseError } = useMemo(
    () => parsePayload(data),
    [data],
  );

  const notConfigured = !cpu;

  const handleOpenEntry = useCallback(
    (entry: KosFileEntry) => {
      const child = joinPath(view.kind === "list" ? view.path : volume, entry.name);
      if (entry.isDir) {
        setView({ kind: "list", path: child });
      } else {
        setView({ kind: "view", path: child });
      }
    },
    [view, volume],
  );

  const handleBackToList = useCallback(() => {
    setView({ kind: "list", path: volume });
  }, [volume]);

  const handleAscend = useCallback(() => {
    if (view.kind !== "list") return;
    const parent = parentPath(view.path, volume);
    setView({ kind: "list", path: parent });
  }, [view, volume]);

  return (
    <KosScriptFrame
      title={cpu ? `Files · ${cpu}` : "Files"}
      running={running}
      scriptError={error ?? payloadError}
      parseError={parseError}
      lastGoodAt={lastGoodAt}
      onRun={dispatch}
      runDisabled={running || notConfigured}
    >
      {renderBody()}
    </KosScriptFrame>
  );

  function renderBody() {
    if (notConfigured) {
      return (
        <Placeholder>
          Configure a kOS CPU tagname and save the script (in the
          widget&apos;s config) to{" "}
          <code>{KOS_FILES_SCRIPT_NAME}</code>.
        </Placeholder>
      );
    }
    if (view.kind === "view") {
      return (
        <ViewerWrap>
          <ViewerHeader>
            <BackButton type="button" onClick={handleBackToList}>
              ← Back
            </BackButton>
            <ViewerPath>{view.path}</ViewerPath>
          </ViewerHeader>
          {renderViewer()}
        </ViewerWrap>
      );
    }
    // List mode
    const currentPath = view.kind === "list" ? view.path : volume;
    const atRoot = isVolumeRoot(currentPath, volume);
    const header = (
      <ListHeader>
        {!atRoot && (
          <BackButton type="button" onClick={handleAscend}>
            ↑ Up
          </BackButton>
        )}
        <ViewerPath>{currentPath}</ViewerPath>
      </ListHeader>
    );
    if (!listing) {
      return (
        <ViewerWrap>
          {header}
          <Placeholder>
            {running ? "Listing…" : `No listing yet for ${currentPath}.`}
          </Placeholder>
        </ViewerWrap>
      );
    }
    if (listing.length === 0) {
      return (
        <ViewerWrap>
          {header}
          <Placeholder>{currentPath} is empty.</Placeholder>
        </ViewerWrap>
      );
    }
    return (
      <ViewerWrap>
        {header}
        <List>
          {listing.map((f) => (
            <Row key={f.name}>
              <FileButton type="button" onClick={() => handleOpenEntry(f)}>
                <FileName $isDir={!!f.isDir}>
                  {f.name}
                  {f.isDir ? "/" : ""}
                </FileName>
                <FileSize>{f.isDir ? "DIR" : formatSize(f.size)}</FileSize>
              </FileButton>
            </Row>
          ))}
        </List>
      </ViewerWrap>
    );
  }

  function renderViewer(): React.ReactNode {
    if (running && contents === null) {
      return <Placeholder>Reading file…</Placeholder>;
    }
    if (contents === null) {
      return <Placeholder>No content yet — press Run.</Placeholder>;
    }
    const truncated = contents.length > MAX_VIEW_CHARS;
    const shown = truncated ? contents.slice(0, MAX_VIEW_CHARS) : contents;
    return (
      <>
        {truncated && (
          <TruncationBanner>
            File is {formatSize(contents.length)} — viewer truncated to the
            first {Math.round(MAX_VIEW_CHARS / 1024)} KB.
          </TruncationBanner>
        )}
        <ViewerBody>{shown}</ViewerBody>
      </>
    );
  }
}

interface ParsedPayload {
  listing: KosFileEntry[] | null;
  contents: string | null;
  payloadError: Error | null;
  parseError: Error | null;
}

function parsePayload(
  data: Record<string, unknown> | null,
): ParsedPayload {
  if (!data) {
    return {
      listing: null,
      contents: null,
      payloadError: null,
      parseError: null,
    };
  }
  // Script-side error path (file not found, etc.)
  if (typeof data.error === "string" && data.error) {
    return {
      listing: null,
      contents: null,
      payloadError: new Error(`kos-files: ${data.error}`),
      parseError: null,
    };
  }
  if (typeof data.listing === "string") {
    try {
      const parsed = JSON.parse(data.listing) as KosFileEntry[];
      return {
        listing: Array.isArray(parsed) ? parsed : null,
        contents: null,
        payloadError: null,
        parseError: null,
      };
    } catch (e) {
      return {
        listing: null,
        contents: null,
        payloadError: null,
        parseError: e instanceof Error ? e : new Error(String(e)),
      };
    }
  }
  if (typeof data.contents === "string") {
    try {
      // The script wraps the contents in `"..."` and emits JSON-escaped
      // characters inside. JSON.parse of the wrapped string yields the
      // raw text.
      const parsed = JSON.parse(data.contents) as string;
      return {
        listing: null,
        contents: typeof parsed === "string" ? parsed : null,
        payloadError: null,
        parseError: null,
      };
    } catch (e) {
      return {
        listing: null,
        contents: null,
        payloadError: null,
        parseError: e instanceof Error ? e : new Error(String(e)),
      };
    }
  }
  return {
    listing: null,
    contents: null,
    payloadError: null,
    parseError: null,
  };
}

function joinPath(base: string, name: string): string {
  // Normalise `0:` / `0:/` / `0:/folder` to a path with a trailing slash,
  // then append the entry name. A bare volume identifier (`Archive`,
  // `0`) gets `:` appended first — kOS-style absolute paths require it.
  let normalised = base;
  if (!normalised.includes(":")) normalised = `${normalised}:`;
  if (!normalised.endsWith("/")) normalised = `${normalised}/`;
  return normalised + name;
}

function parentPath(path: string, volumeRoot: string): string {
  // Strip a trailing slash, then drop the last `/`-segment. If we'd end
  // up above the configured volume root, snap back to it.
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  if (slash <= trimmed.indexOf(":")) return volumeRoot;
  return trimmed.slice(0, slash);
}

function isVolumeRoot(path: string, volume: string): boolean {
  const a = path.replace(/\/+$/, "");
  const b = volume.replace(/\/+$/, "");
  if (a === b) return true;
  // `0:` and `0` both refer to the same volume root depending on syntax.
  if (a.replace(/:$/, "") === b.replace(/:$/, "")) return true;
  return false;
}

function formatSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── Config ────────────────────────────────────────────────────────────────────

function KosFilesConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<KosFilesConfig>>) {
  const [cpu, setCpu] = useState(config?.cpu ?? "");
  const [scriptName, setScriptName] = useState(
    config?.scriptName ?? KOS_FILES_SCRIPT_NAME,
  );
  const [volume, setVolume] = useState(config?.volume ?? DEFAULT_VOLUME);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard?.writeText(KOS_FILES_SCRIPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="kos-files-cpu">kOS CPU tagname</FieldLabel>
        <Input
          id="kos-files-cpu"
          type="text"
          value={cpu}
          placeholder="e.g. MainCPU"
          onChange={(e) => setCpu(e.target.value)}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="kos-files-script-name">Script name</FieldLabel>
        <Input
          id="kos-files-script-name"
          type="text"
          value={scriptName}
          onChange={(e) => setScriptName(e.target.value)}
        />
        <FieldHint>
          Path to the saved dispatcher script on your kOS volume. Defaults to{" "}
          <code>{KOS_FILES_SCRIPT_NAME}</code>.
        </FieldHint>
      </Field>

      <Field>
        <FieldLabel htmlFor="kos-files-volume">Volume root</FieldLabel>
        <Input
          id="kos-files-volume"
          type="text"
          value={volume}
          onChange={(e) => setVolume(e.target.value)}
        />
        <FieldHint>
          The starting directory the browser opens at. Use{" "}
          <code>0:</code> for the local processor volume, <code>Archive</code>{" "}
          (or <code>1:</code>) for the cross-vessel archive. You can drill
          into subdirectories from the widget.
        </FieldHint>
      </Field>

      <Field>
        <ScriptHeader>
          <FieldLabel>Script</FieldLabel>
          <GhostButton type="button" onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </GhostButton>
        </ScriptHeader>
        <FieldHint>
          Paste this into{" "}
          <code>
            {scriptName.endsWith(".ks") ? scriptName : `${scriptName}.ks`}
          </code>{" "}
          on your kOS Archive volume. Contract:{" "}
          <code>[KOSDATA]op=…;listing=… or contents=…[/KOSDATA]</code>.
        </FieldHint>
        <ScriptBox>
          <pre>{KOS_FILES_SCRIPT}</pre>
        </ScriptBox>
      </Field>

      <PrimaryButton onClick={() => onSave({ cpu, scriptName, volume })}>
        Save
      </PrimaryButton>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Placeholder = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 11px;
  padding: 12px;
  text-align: center;
  code {
    background: #1a1a1a;
    padding: 1px 4px;
    border-radius: 2px;
    color: #cfe;
  }
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
`;

const Row = styled.li`
  display: flex;
`;

const FileButton = styled.button`
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  color: #cfe;
  font-family: monospace;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  &:hover {
    background: #141414;
    border-color: #2a2a2a;
  }
  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
  }
`;

const FileName = styled.span<{ $isDir?: boolean }>`
  word-break: break-all;
  ${({ $isDir }) => ($isDir ? "color: #9cf; font-weight: 600;" : "")}
`;

const ListHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: #141414;
  border-bottom: 1px solid #1f1f1f;
  flex-shrink: 0;
`;

const FileSize = styled.span`
  color: #666;
  font-size: 11px;
  flex-shrink: 0;
`;

const ViewerWrap = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
`;

const ViewerHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: #141414;
  border-bottom: 1px solid #1f1f1f;
  flex-shrink: 0;
`;

const BackButton = styled.button`
  background: #1a1a1a;
  color: #cfe;
  border: 1px solid #2a2a2a;
  border-radius: 2px;
  padding: 2px 8px;
  font-size: 11px;
  font-family: monospace;
  cursor: pointer;
  &:hover {
    background: #222;
  }
  &:focus-visible {
    outline: 2px solid #00ff88;
    outline-offset: 2px;
  }
`;

const ViewerPath = styled.div`
  font-family: monospace;
  font-size: 11px;
  color: #888;
  word-break: break-all;
  flex: 1;
  min-width: 0;
`;

const TruncationBanner = styled.div`
  background: #2a1a0a;
  color: #ffb74d;
  border-bottom: 1px solid #3a2a0a;
  padding: 4px 10px;
  font-size: 10px;
  flex-shrink: 0;
`;

const ViewerBody = styled.pre`
  margin: 0;
  padding: 8px 10px;
  background: #050505;
  color: #cfe;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre;
  overflow: auto;
  flex: 1;
  min-height: 0;
`;

const ScriptHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const ScriptBox = styled.div`
  max-height: 260px;
  overflow: auto;
  background: #0a0a0a;
  border: 1px solid #222;
  border-radius: 3px;
  padding: 6px 8px;
  font-family: monospace;
  font-size: 11px;
  color: #cfe;
  pre {
    margin: 0;
    white-space: pre;
  }
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<KosFilesConfig>({
  id: "kos-files",
  name: "kOS Files",
  description:
    "View files on a kOS volume without alt-tabbing. Lists the chosen volume's top-level files; click one to read its contents. Driven by a saved kerboscript dispatcher; press Run to refresh.",
  tags: ["kos", "files"],
  defaultSize: { w: 6, h: 10 },
  component: KosFilesComponent,
  configComponent: KosFilesConfigComponent,
  openConfigOnAdd: true,
  dataRequirements: [],
  defaultConfig: {
    cpu: "",
    scriptName: KOS_FILES_SCRIPT_NAME,
    volume: DEFAULT_VOLUME,
  },
  actions: [],
  pushable: true,
});

export { KosFilesComponent };
