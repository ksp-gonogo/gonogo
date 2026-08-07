import type {
  KerbalismLifeSupport,
  KerbalismProcessDef,
  KerbalismProcessEntry,
  KerbalismProfile,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * Derivation over the Kerbalism wire payloads: the resource graph, the
 * per-source rate ledger, and the root-cause walk.
 *
 * The mod parses, the app derives. `kerbalism.profile` carries the loaded
 * profile's own rules and processes and nothing else, so everything here is a
 * PURE function of two payloads plus the vessel's resource levels. No React, no
 * hooks, no KSP: a widget calls these, and so does a test.
 *
 * Nothing in this file names a resource. Every name comes from the profile.
 */

// ── Shared plumbing ─────────────────────────────────────────────────────────

/** A wire quantity, or a bare number where a unit could not be carried. */
type Quantityish = { magnitude?: number } | number | null | undefined;

/** Magnitude of a wire quantity, defaulting rather than throwing on absence. */
function mag(q: Quantityish, fallback = 0): number {
  if (typeof q === "number") return q;
  const m = q?.magnitude;
  return typeof m === "number" && Number.isFinite(m) ? m : fallback;
}

/** A resource this profile touches, with the static facts about it. */
export interface ResourceFacts {
  name: string;
  displayName: string;
  /** KSP ResourceFlowMode name, or "" when the mod could not read one. */
  flowMode: string;
  /**
   * True when the profile declares a Supply for it, i.e. it is life support
   * rather than a propellant some process merely touches. The profile's call,
   * never ours.
   */
  isSupply: boolean;
  /**
   * True when the resource pools across the whole vessel, so a per-part meter
   * is bookkeeping rather than a reading. Unknown (`undefined`) when flowMode
   * is missing, which a consumer must NOT read as "not pooled": the honest
   * render is "share of a vessel-wide pool, mode unknown".
   */
  pooled: boolean | undefined;
}

const POOLED_MODES = new Set(["ALL_VESSEL", "ALL_VESSEL_BALANCE"]);

export function resourceFacts(
  profile: KerbalismProfile | undefined,
): Map<string, ResourceFacts> {
  const out = new Map<string, ResourceFacts>();
  for (const [name, def] of Object.entries(profile?.resources ?? {})) {
    const flowMode = def.flowMode ?? "";
    out.set(name, {
      name,
      displayName: def.displayName || name,
      flowMode,
      isSupply: def.isSupply === true,
      pooled: flowMode ? POOLED_MODES.has(flowMode) : undefined,
    });
  }
  return out;
}

// ── The ledger ──────────────────────────────────────────────────────────────

/** One signed term in a resource's net rate. */
export interface LedgerTerm {
  /** Process name from the profile, or rule name for a crew rule. */
  name: string;
  kind: "process" | "rule";
  /** Host part's flightID for a process; undefined for a crew rule. */
  flightId?: number;
  /** Signed units/s. Negative consumes, positive produces. */
  ratePerSecond: number;
  /** Process capacity, or crew count for a rule. What the rate was scaled by. */
  scale: number;
}

export interface Ledger {
  resource: string;
  terms: LedgerTerm[];
  /** Sum of the terms, units/s. What we think the net is. */
  derivedNet: number;
  /**
   * Kerbalism's own `ResourceAverageRate`, units/s, or undefined when it
   * reported none.
   */
  reportedNet: number | undefined;
  /**
   * reportedNet - derivedNet. The modifier product (pressure, lamps, radiation)
   * scales each process at runtime and is NOT on the wire, so the terms are
   * NOMINAL, not actual. This residual is exactly how wrong they are, and a
   * widget should surface it rather than hide it: a large residual means the
   * breakdown is not to be trusted, which is a real thing to tell an operator.
   * Undefined when there is no reported net to compare against.
   */
  residual: number | undefined;
}

/** Index the profile's processes by the pseudo-resource that joins to a part. */
function processesByModifier(
  profile: KerbalismProfile | undefined,
): Map<string, KerbalismProcessDef> {
  const out = new Map<string, KerbalismProcessDef>();
  for (const proc of profile?.processes ?? []) {
    for (const token of proc.modifiers ?? []) out.set(token, proc);
  }
  return out;
}

export interface LedgerInput {
  resource: string;
  profile: KerbalismProfile | undefined;
  lifeSupport: KerbalismLifeSupport | undefined;
  /** Head count aboard; crew rules scale by it. */
  crew: number;
}

/**
 * Decompose one resource's net rate into the named, located terms it is a sum
 * of. This is the whole point of the exercise: a net rate alone says water is
 * draining slowly, while the ledger says the recycler is already carrying most
 * of the load and the real failure mode is the recycler stopping.
 */
export function buildLedger({
  resource,
  profile,
  lifeSupport,
  crew,
}: LedgerInput): Ledger {
  const byModifier = processesByModifier(profile);
  const terms: LedgerTerm[] = [];

  for (const entry of lifeSupport?.processes ?? []) {
    // Broken or switched off contributes nothing, and saying so is more useful
    // than omitting the row: the operator wants to know the recycler is fitted
    // AND idle. Callers that want the fitted-but-idle rows render terms with a
    // zero rate; here they are simply not part of the sum.
    if (entry.broken === true || entry.running !== true) continue;
    const def = entry.resource ? byModifier.get(entry.resource) : undefined;
    if (!def) continue;
    const capacity = mag(entry.capacity);
    const perCapacityIn = mag(def.inputs?.[resource], Number.NaN);
    const perCapacityOut = mag(def.outputs?.[resource], Number.NaN);
    const signed =
      (Number.isNaN(perCapacityOut) ? 0 : perCapacityOut) -
      (Number.isNaN(perCapacityIn) ? 0 : perCapacityIn);
    if (signed === 0) continue;
    terms.push({
      name: def.name || entry.title || entry.resource || "process",
      kind: "process",
      flightId: entry.flightId === undefined ? undefined : mag(entry.flightId),
      ratePerSecond: signed * capacity,
      scale: capacity,
    });
  }

  for (const rule of profile?.rules ?? []) {
    // ratePerSecond, never `rate`: a Rule with an interval fires once per
    // interval, and the mod already did that division so nobody repeats it.
    const perSecond = mag(rule.ratePerSecond);
    if (perSecond === 0) continue;
    const signed =
      rule.input === resource
        ? -perSecond
        : rule.output === resource
          ? perSecond
          : 0;
    if (signed === 0) continue;
    terms.push({
      name: rule.name || "rule",
      kind: "rule",
      ratePerSecond: signed * crew,
      scale: crew,
    });
  }

  terms.sort((a, b) => Math.abs(b.ratePerSecond) - Math.abs(a.ratePerSecond));
  const derivedNet = terms.reduce((sum, t) => sum + t.ratePerSecond, 0);
  const reported = lifeSupport?.rates?.[resource];
  const reportedNet = reported === undefined ? undefined : mag(reported);
  return {
    resource,
    terms,
    derivedNet,
    reportedNet,
    residual: reportedNet === undefined ? undefined : reportedNet - derivedNet,
  };
}

// ── The graph ───────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  label: string;
  kind: "resource" | "process" | "rule";
}

export interface ResourceGraph {
  nodes: Map<string, GraphNode>;
  /** node id -> node ids it feeds. */
  edges: Map<string, Set<string>>;
}

/**
 * The whole profile as a directed graph: resource -> converter -> resource.
 * Rules are nodes too, because a crew rule is a converter that happens to be
 * scaled by head count rather than part capacity.
 */
export function buildGraph(
  profile: KerbalismProfile | undefined,
): ResourceGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, Set<string>>();
  const node = (id: string, label: string, kind: GraphNode["kind"]) => {
    if (!nodes.has(id)) nodes.set(id, { id, label, kind });
    if (!edges.has(id)) edges.set(id, new Set());
    return id;
  };
  const link = (from: string, to: string) => {
    edges.get(from)?.add(to);
  };
  const res = (name: string) => node(`r:${name}`, name, "resource");

  for (const proc of profile?.processes ?? []) {
    const id = node(`p:${proc.name}`, proc.name || "process", "process");
    for (const name of Object.keys(proc.inputs ?? {})) link(res(name), id);
    for (const name of Object.keys(proc.outputs ?? {})) link(id, res(name));
  }
  for (const rule of profile?.rules ?? []) {
    // A rule with neither end is a pure accumulator (stress, radiation): it
    // models a hazard, moves no resource, and belongs in no graph edge.
    if (!rule.input && !rule.output) continue;
    const id = node(`u:${rule.name}`, rule.name || "rule", "rule");
    if (rule.input) link(res(rule.input), id);
    if (rule.output) link(id, res(rule.output));
  }
  return { nodes, edges };
}

/**
 * Strongly connected components, smallest-first by insertion. A component of
 * more than one node contains a cycle, which for this graph means a closed
 * loop: waste going back round into the thing that produced it.
 *
 * Iterative rather than recursive on purpose. The stock profile's largest
 * component is 35 nodes and RO's is 57, which recursion survives, but a
 * third-party profile is unbounded and a blown stack inside a render is a
 * white screen.
 */
export function stronglyConnected(graph: ResourceGraph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;

  for (const root of graph.nodes.keys()) {
    if (index.has(root)) continue;
    // Each frame is a node plus how many of its successors we have consumed.
    const work: { node: string; next: number; succ: string[] }[] = [
      { node: root, next: 0, succ: [...(graph.edges.get(root) ?? [])] },
    ];
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame.next < frame.succ.length) {
        const child = frame.succ[frame.next++];
        if (!index.has(child)) {
          index.set(child, counter);
          low.set(child, counter);
          counter++;
          stack.push(child);
          onStack.add(child);
          work.push({
            node: child,
            next: 0,
            succ: [...(graph.edges.get(child) ?? [])],
          });
        } else if (onStack.has(child)) {
          low.set(
            frame.node,
            Math.min(low.get(frame.node) ?? 0, index.get(child) ?? 0),
          );
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        low.set(
          parent.node,
          Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0),
        );
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const popped = stack.pop();
          if (popped === undefined) break;
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) break;
        }
        out.push(component);
      }
    }
  }
  return out;
}

/** Every closed loop in the profile, as resource names, largest first. */
export function closedLoops(profile: KerbalismProfile | undefined): string[][] {
  const graph = buildGraph(profile);
  return stronglyConnected(graph)
    .filter((c) => c.length > 1)
    .map((c) =>
      c
        .filter((id) => id.startsWith("r:"))
        .map((id) => id.slice(2))
        .sort(),
    )
    .filter((c) => c.length > 0)
    .sort((a, b) => b.length - a.length);
}

// ── The diagnosis ───────────────────────────────────────────────────────────

export interface DiagnosisGroup {
  /** Resource names. More than one means they block each other. */
  resources: string[];
  /** True when this group is a mutual block rather than a single resource. */
  cycle: boolean;
  /** A root cause blames nothing outside itself; everything else is downstream. */
  role: "root" | "downstream";
  /** Signed net rate per member, units/s. */
  net: Record<string, number>;
  /** Resources outside this group that it is waiting on. */
  blockedBy: string[];
  /** Groups this one explains, i.e. everything downstream of it. */
  explains: string[];
}

export interface DiagnosisInput {
  profile: KerbalismProfile | undefined;
  lifeSupport: KerbalismLifeSupport | undefined;
  /** Current amount per resource name, from `vessel.resources`. */
  stored: Record<string, number>;
  /**
   * A producer must be able to cover at least this share of a resource's gap
   * before it is allowed to implicate its own inputs. Without it, everything is
   * downstream of everything and the "root cause" falls out as whichever
   * resource happens to sort last.
   */
  materiality?: number;
}

const DEFAULT_MATERIALITY = 0.05;

/**
 * Why is this vessel short of things, and which shortage is worth acting on.
 *
 * Walks back from each shortage to whichever input is throttling its producers,
 * then CONDENSES: resources that block each other collapse into one finding,
 * because reporting them separately sends an operator chasing three symptoms of
 * one cause. Water short because the recycler is short of power, while the
 * electrolyser that would make the power is short of water, is one problem.
 */
export function diagnose({
  profile,
  lifeSupport,
  stored,
  materiality = DEFAULT_MATERIALITY,
}: DiagnosisInput): DiagnosisGroup[] {
  const net: Record<string, number> = {};
  for (const [name, rate] of Object.entries(lifeSupport?.rates ?? {})) {
    net[name] = mag(rate);
  }
  const short = new Set(Object.keys(net).filter((r) => net[r] < 0));
  const byModifier = processesByModifier(profile);

  // R -> X when a fitted producer of R is throttled by a starved X.
  const blames = new Map<string, Set<string>>();
  for (const resource of short) {
    const gap = Math.abs(net[resource]);
    const set = new Set<string>();
    for (const entry of lifeSupport?.processes ?? []) {
      if (entry.broken === true || entry.running !== true) continue;
      const def = entry.resource ? byModifier.get(entry.resource) : undefined;
      const produced = def?.outputs?.[resource];
      if (!def || produced === undefined) continue;
      // A producer too small to move the needle may not implicate anything:
      // a 0.05-capacity fuel cell is not the answer to a station water gap.
      if (mag(produced) * mag(entry.capacity) < gap * materiality) continue;
      for (const input of Object.keys(def.inputs ?? {})) {
        if (input === resource) continue;
        if (short.has(input) || (stored[input] ?? 0) <= 0) set.add(input);
      }
    }
    blames.set(resource, set);
  }

  // Condense. Nodes are the short resources plus anything they blame (a blamed
  // resource can be empty without being in deficit).
  const names = [
    ...new Set([...short, ...[...blames.values()].flatMap((s) => [...s])]),
  ];
  const graph: ResourceGraph = {
    nodes: new Map(
      names.map((n) => [n, { id: n, label: n, kind: "resource" as const }]),
    ),
    edges: new Map(names.map((n) => [n, new Set([...(blames.get(n) ?? [])])])),
  };
  const components = stronglyConnected(graph).map((c) => c.sort());
  const owner = new Map<string, number>();
  components.forEach((c, i) => {
    for (const n of c) owner.set(n, i);
  });

  // Component-level blame, then reachability so a root can say what it explains.
  const out = new Map<number, Set<number>>();
  for (const n of names) {
    for (const m of blames.get(n) ?? []) {
      const a = owner.get(n);
      const b = owner.get(m);
      if (a !== undefined && b !== undefined && a !== b) {
        if (!out.has(a)) out.set(a, new Set());
        out.get(a)?.add(b);
      }
    }
  }
  const reachesMe = new Map<number, Set<number>>();
  for (const [a, bs] of out) {
    for (const b of bs) {
      if (!reachesMe.has(b)) reachesMe.set(b, new Set());
      reachesMe.get(b)?.add(a);
    }
  }
  const downstreamOf = (i: number): Set<number> => {
    const seen = new Set<number>();
    const queue = [...(reachesMe.get(i) ?? [])];
    while (queue.length > 0) {
      const next = queue.pop();
      if (next === undefined || seen.has(next)) continue;
      seen.add(next);
      queue.push(...(reachesMe.get(next) ?? []));
    }
    return seen;
  };

  return components
    .map((resources, i) => ({
      resources,
      cycle: resources.length > 1,
      role: (out.get(i)?.size
        ? "downstream"
        : "root") as DiagnosisGroup["role"],
      net: Object.fromEntries(resources.map((r) => [r, net[r] ?? 0])),
      blockedBy: [
        ...new Set(
          resources.flatMap((r) =>
            [...(blames.get(r) ?? [])].filter((m) => owner.get(m) !== i),
          ),
        ),
      ].sort(),
      explains: [...downstreamOf(i)].flatMap((j) => components[j]).sort(),
    }))
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "root" ? -1 : 1;
      return b.explains.length - a.explains.length;
    });
}

/** Seconds until a resource runs out at its current rate; null while not draining. */
export function timeToEmptySeconds(
  resource: string,
  lifeSupport: KerbalismLifeSupport | undefined,
  stored: Record<string, number>,
): number | null {
  const rate = lifeSupport?.rates?.[resource];
  if (rate === undefined) return null;
  const perSecond = mag(rate);
  if (perSecond >= 0) return null;
  return (stored[resource] ?? 0) / -perSecond;
}
