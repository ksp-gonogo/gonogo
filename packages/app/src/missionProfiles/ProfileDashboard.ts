import type { Layout } from "react-grid-layout";
import type { DashboardItem } from "../components/Dashboard";
import { type LayoutTemplate, snapshotOf } from "./layoutTemplates";
import type {
  BindableScene,
  MissionProfile,
  MissionProfilesService,
} from "./MissionProfilesService";

export interface DashboardSnapshot {
  items: DashboardItem[];
  layout: Layout;
}

/** How a switch came about, so the notice can say so. */
export type SwitchCause =
  | { kind: "manual" }
  | { kind: "scene"; scene: BindableScene }
  | { kind: "input"; inputLabel: string }
  | { kind: "undo" }
  | { kind: "redo" };

export interface SwitchEvent {
  profile: MissionProfile;
  cause: SwitchCause;
}

type HistoryEntry =
  | {
      kind: "edit";
      profileId: string;
      before: DashboardSnapshot;
      after: DashboardSnapshot;
    }
  | {
      kind: "switch";
      from: string | null;
      to: string;
      fromState: DashboardSnapshot;
    };

/** What an undo or redo step covers: edits to the widgets, or a change of layout. */
export type HistoryStep = "change" | "switch";

function stepOf(entry: HistoryEntry | undefined): HistoryStep | null {
  if (!entry) return null;
  return entry.kind === "edit" ? "change" : "switch";
}

/** Changes closer together than this are one autosave and one undo step. */
export const AUTOSAVE_DELAY_MS = 400;

/** Undo steps kept per profile for the session, oldest dropped first. */
export const UNDO_DEPTH = 50;

/**
 * How long after a screen load the grid may still reshape the layout it was
 * given (compaction, minimum sizes). A reshape inside the window is the same
 * dashboard as far as the operator is concerned: it is saved into the
 * profile but never offered as an undo step.
 */
const SETTLE_MS = 500;

/** What a dashboard is, ignoring the bookkeeping fields the grid adds. */
function print(items: DashboardItem[], layout: Layout): string {
  const byId = (a: { i: string }, b: { i: string }) => a.i.localeCompare(b.i);
  return JSON.stringify([
    [...items].sort(byId),
    layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })).sort(byId),
  ]);
}

function itemsPrint(items: DashboardItem[]): string {
  return JSON.stringify([...items].sort((a, b) => a.i.localeCompare(b.i)));
}

/**
 * Keeps the dashboard on screen and the profile it belongs to in step: every
 * change is written into the current profile (debounced), a switch changes
 * which profile is current, and undo and redo walk back through both. The
 * history lives in memory for the session.
 *
 * Framework-free; `useProfileDashboard` binds it to the dashboard state.
 */
export class ProfileDashboard {
  private shown: DashboardSnapshot;
  private settleUntil: number;
  /** The dashboard as it was before the changes still waiting to be written. */
  private pending: { before: DashboardSnapshot } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<() => void>();
  private switchListeners = new Set<(event: SwitchEvent) => void>();

  constructor(
    private readonly service: MissionProfilesService,
    private readonly apply: (snapshot: DashboardSnapshot) => void,
    initial: DashboardSnapshot,
  ) {
    this.shown = initial;
    this.settleUntil = Date.now() + SETTLE_MS;
  }

  /** Starts following the service; the returned function flushes and stops. */
  attach(): () => void {
    const stop = this.service.subscribe(() => this.prune());
    return () => {
      stop();
      this.flush();
    };
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Tells the listener about every switch, whatever caused it. */
  onSwitch(cb: (event: SwitchEvent) => void): () => void {
    this.switchListeners.add(cb);
    return () => this.switchListeners.delete(cb);
  }

  canUndo(): boolean {
    return this.pending !== null || this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** What undo would step back over, or null when there is nothing to undo. */
  undoStep(): HistoryStep | null {
    if (this.pending !== null) return "change";
    return stepOf(this.undoStack[this.undoStack.length - 1]);
  }

  /** What redo would step forward over, or null when there is nothing to redo. */
  redoStep(): HistoryStep | null {
    return stepOf(this.redoStack[this.redoStack.length - 1]);
  }

  /** The dashboard changed on screen: autosave it into the current profile. */
  recordChange = (items: DashboardItem[], layout: Layout): void => {
    if (print(this.shown.items, this.shown.layout) === print(items, layout)) {
      return;
    }
    const next = { items, layout };
    if (
      this.pending === null &&
      Date.now() < this.settleUntil &&
      itemsPrint(this.shown.items) === itemsPrint(items)
    ) {
      this.shown = next;
      const id = this.service.getCurrentId();
      if (id) this.service.writeContent(id, items, layout, { touch: false });
      return;
    }
    if (this.pending === null) {
      this.pending = { before: this.shown };
      this.redoStack = [];
    }
    this.shown = next;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), AUTOSAVE_DELAY_MS);
    this.emit();
  };

  /** Writes any change still waiting out the autosave delay. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    const { items, layout } = this.shown;
    let id = this.service.getCurrentId();
    if (id) {
      this.service.writeContent(id, items, layout);
    } else {
      id = this.service.createDraft(items, layout).id;
    }
    this.pushUndo({
      kind: "edit",
      profileId: id,
      before: pending.before,
      after: this.shown,
    });
    this.emit();
  }

  /** Makes another profile current and shows it. False when nothing changed. */
  switchTo(id: string, cause: SwitchCause = { kind: "manual" }): boolean {
    const target = this.service.get(id);
    if (!target || id === this.service.getCurrentId()) return false;
    this.flush();
    this.pushUndo({
      kind: "switch",
      from: this.service.getCurrentId(),
      to: id,
      fromState: this.shown,
    });
    this.redoStack = [];
    this.service.setCurrent(id);
    this.show({ items: target.items, layout: target.layout });
    this.emitSwitch({ profile: target, cause });
    this.emit();
    return true;
  }

  /** Copies what is on screen into a new named profile and makes it current. */
  saveAs(
    name: string,
    sceneBindings: BindableScene[] = [],
    autoSwitch = false,
  ): MissionProfile {
    return this.createLayout(name, this.shown, sceneBindings, autoSwitch);
  }

  /**
   * Makes a new named profile holding `content` (an empty dashboard when
   * omitted), shows it and makes it current. One undo step returns to the
   * dashboard that was on screen.
   */
  createLayout(
    name: string,
    content: DashboardSnapshot = { items: [], layout: [] },
    sceneBindings: BindableScene[] = [],
    autoSwitch = false,
  ): MissionProfile {
    this.flush();
    const created = this.service.save(
      name,
      content.items,
      content.layout,
      sceneBindings,
      autoSwitch,
    );
    this.enter(created);
    return created;
  }

  /** Copies a saved profile under a new name, without its scenes or input. */
  duplicate(id: string): MissionProfile | null {
    const source = this.service.get(id);
    if (!source) return null;
    // Flush first so a duplicate of the current layout includes pending edits.
    this.flush();
    const fresh = this.service.get(id) ?? source;
    return this.createLayout(`${fresh.name} copy`, {
      items: fresh.items,
      layout: fresh.layout,
    });
  }

  /**
   * Creates one profile per template, each following its scenes with
   * automatic switching on, and shows the one for `scene` (the first
   * template when no template follows it). One undo step covers all of it.
   */
  addTemplates(
    templates: readonly LayoutTemplate[],
    scene?: BindableScene,
  ): MissionProfile[] {
    this.flush();
    const created = templates.map((t) => {
      const content = snapshotOf(t);
      return this.service.save(
        t.name,
        content.items,
        content.layout,
        [...t.scenes],
        true,
      );
    });
    const shown =
      created.find((p) => scene && p.sceneBindings?.includes(scene)) ??
      created[0];
    if (shown) this.enter(shown);
    return created;
  }

  /** Makes a profile just created the current one, as an undoable switch. */
  private enter(profile: MissionProfile): void {
    this.pushUndo({
      kind: "switch",
      from: this.service.getCurrentId(),
      to: profile.id,
      fromState: this.shown,
    });
    this.redoStack = [];
    this.service.setCurrent(profile.id);
    this.show({ items: profile.items, layout: profile.layout });
    this.emit();
  }

  undo(): void {
    this.flush();
    const entry = this.undoStack.pop();
    if (!entry) return;
    if (entry.kind === "edit") {
      this.service.setCurrent(entry.profileId);
      this.service.writeContent(
        entry.profileId,
        entry.before.items,
        entry.before.layout,
      );
      this.show(entry.before);
    } else {
      const from = entry.from ? this.service.get(entry.from) : undefined;
      this.service.setCurrent(from?.id ?? null);
      this.show(
        from ? { items: from.items, layout: from.layout } : entry.fromState,
      );
      if (from) this.emitSwitch({ profile: from, cause: { kind: "undo" } });
    }
    this.redoStack.push(entry);
    this.emit();
  }

  redo(): void {
    this.flush();
    const entry = this.redoStack.pop();
    if (!entry) return;
    if (entry.kind === "edit") {
      this.service.setCurrent(entry.profileId);
      this.service.writeContent(
        entry.profileId,
        entry.after.items,
        entry.after.layout,
      );
      this.show(entry.after);
    } else {
      const to = this.service.get(entry.to);
      if (to) {
        this.service.setCurrent(to.id);
        this.show({ items: to.items, layout: to.layout });
        this.emitSwitch({ profile: to, cause: { kind: "redo" } });
      }
    }
    this.undoStack.push(entry);
    this.emit();
  }

  private show(snapshot: DashboardSnapshot): void {
    this.shown = snapshot;
    this.settleUntil = Date.now() + SETTLE_MS;
    this.apply(snapshot);
  }

  private pushUndo(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (entry.kind !== "edit") return;
    const mine = this.undoStack.filter(
      (e) => e.kind === "edit" && e.profileId === entry.profileId,
    );
    if (mine.length > UNDO_DEPTH) {
      this.undoStack.splice(this.undoStack.indexOf(mine[0]), 1);
    }
  }

  /** Forgets history that names a profile that has been deleted. */
  private prune(): void {
    const alive = (id: string | null) => id === null || !!this.service.get(id);
    const keep = (e: HistoryEntry) =>
      e.kind === "edit" ? alive(e.profileId) : alive(e.from) && alive(e.to);
    const before = this.undoStack.length + this.redoStack.length;
    this.undoStack = this.undoStack.filter(keep);
    this.redoStack = this.redoStack.filter(keep);
    if (this.undoStack.length + this.redoStack.length !== before) this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private emitSwitch(event: SwitchEvent): void {
    for (const l of this.switchListeners) l(event);
  }
}
