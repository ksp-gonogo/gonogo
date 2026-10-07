import {
  type RevealedEventSourceDefinition,
  registerRevealedEventSource,
} from "../api/event-reveal";
import {
  type RootProviderDefinition,
  registerRootProvider,
} from "../api/root-providers";
import type { ContributionDefinition, ContributionDep } from "../api/types";
import type { DepWindows, ReckonerDefinition } from "../reading";
import type { DerivedChannelDefinition } from "../timeline";
import type { TopicId, TopicPayload } from "../topics";
import { contributeDerivedChannel } from "./contributed-channels";
import { registerContribution } from "./contributions";
import type {
  CarriesCurrency,
  Dep,
  ProcessorFrame,
  ProcessorHandle,
  ResolvedDeps,
} from "./processors";
import { defineProcessor } from "./processors";
import { registerReckoner } from "./reckoners";

/**
 * An Uplink client's identity and its registration methods, returned by
 * {@link defineUplinkClient}. Declare one per client, in one module, and import
 * it wherever the client registers something.
 *
 * Every `register...` method on the handle prefixes the id it is given with
 * the Uplink's own, `my-uplink:<id>`, so two Uplinks can use the same local ids
 * without colliding. `registerComponent` and `registerAugment` are not methods
 * of the handle: they take the handle as `owner` and use the id as written.
 *
 * @example
 * ```tsx
 * import { defineUplinkClient, registerComponent } from "@ksp-gonogo/sitrep-sdk";
 *
 * export const MY_UPLINK = defineUplinkClient({
 *   id: "my-uplink",
 *   version: "1.0.0",
 *   name: "My Uplink",
 *   description: "Shows the state of my mod's experiments.",
 * });
 *
 * function MyStatus() {
 *   return <p>All experiments nominal</p>;
 * }
 *
 * registerComponent({
 *   id: "my-uplink-status",
 *   name: "My Status",
 *   description: "The state of every experiment aboard.",
 *   tags: ["telemetry"],
 *   component: MyStatus,
 *   owner: MY_UPLINK,
 * });
 * ```
 *
 * @category Registering
 */
export interface UplinkClientHandle {
  /** The Uplink's id. It must match the id its mod declares with `[SitrepUplink]` and the id in its `gonogo-uplink.json`. */
  id: string;
  /** The Uplink's version, the same for its mod and its client. */
  version: string;
  /** The Uplink's name, as the app lists it. */
  name: string;
  /**
   * What the Uplink does, in one or two sentences. It opens the Uplink's
   * generated page and describes it wherever the app lists what is installed.
   * Each widget's own description belongs on its registration, not here.
   *
   * `uplink-tools docs` will not write a page for an Uplink without one.
   */
  description?: string;
  /**
   * Mounts a provider around every screen, so widgets that share state can
   * find it above them. See {@link RootProviderDefinition}.
   */
  registerRootProvider(def: RootProviderDefinition): void;

  /**
   * Feeds this Uplink's events to the `event` alarm trigger. The source is
   * asked for its events with the UT the operator is viewing, which lags the
   * game under signal delay; return only the events that have happened by
   * then.
   */
  registerRevealedEventSource(def: RevealedEventSourceDefinition): void;

  /**
   * Fills another widget's contribution slot. See {@link ContributionDefinition}
   * for what `def` holds and when `compute` runs. Throws when this Uplink has
   * already registered a contribution with the same id.
   */
  registerContribution<
    Slot extends string,
    const Deps extends readonly ContributionDep[] = readonly [],
  >(def: Omit<ContributionDefinition<Slot, Deps>, "owner">): void;
  /**
   * Registers a Processor, a value computed from Topics once per frame and
   * shared by every reader. Returns the handle to read it by, with
   * {@link useProcessor} or as one of a contribution's `deps`.
   */
  registerProcessor<
    const Deps extends readonly Dep[],
    Result,
    const ProcessorId extends string,
  >(def: {
    id: ProcessorId;
    deps: Deps;
    compute: (values: ResolvedDeps<Deps>, frame: ProcessorFrame) => Result;
  }): ProcessorHandle<
    Result,
    `${string}:${ProcessorId}`,
    CarriesCurrency<Deps>
  >;
  /**
   * Registers this Uplink's forward model for `topic`: how the Topic's value
   * moves on while no new sample has arrived. Register a model only for a
   * Topic your Uplink serves. When two Uplinks register one for the same
   * Topic, neither is used and Gonogo's own model applies.
   *
   * The model lists its inputs in `deps`, in the notation a Processor uses, so
   * it can read other Topics. When one of them is absent, the model does not
   * run.
   */
  registerReckoner<
    const Topic extends TopicId,
    Projection = TopicPayload<Topic>,
    const Deps extends readonly Dep[] = readonly Dep[],
    const Windows extends DepWindows<Deps> = Record<never, never>,
  >(
    topic: Topic,
    reckoner: ReckonerDefinition<
      TopicPayload<Topic>,
      Projection,
      Deps,
      Windows
    >,
  ): void;
  /**
   * Adds a derived channel: a Topic whose value is computed from other Topics
   * in the app rather than sent by the mod.
   *
   * An Uplink cannot replace a Topic Gonogo already derives, and when two
   * Uplinks derive the same Topic, neither is used.
   */
  registerDerivedChannel<Payload>(def: DerivedChannelDefinition<Payload>): void;
}

/**
 * One global slot rather than a module static, for the same reason every other
 * registry that moved here has one: a second copy is a declared client the
 * health and settings surfaces never enumerate, with no error anywhere.
 */
const UPLINK_CLIENTS_KEY = "__GONOGO_UPLINK_CLIENTS__" as const;

function clients(): Map<string, UplinkClientHandle> {
  const slot = globalThis as typeof globalThis & {
    [UPLINK_CLIENTS_KEY]?: Map<string, UplinkClientHandle>;
  };
  slot[UPLINK_CLIENTS_KEY] ??= new Map();
  return slot[UPLINK_CLIENTS_KEY];
}

/**
 * Declare a client's identity and record it in the client registry. Returns
 * a frozen handle: stamp it as `owner` on every `registerComponent`/
 * `registerAugment` call the client makes, or call its bound
 * `registerContribution` for the contributions path (auto-stamped, no manual
 * `owner` field needed there).
 *
 * Best-effort on re-declaration under the same id: last-write-wins (a plain
 * `Map.set`), matching `registerUplinkHandle`'s overwrite semantics rather
 * than `registerComponent`'s throw-on-collision. A client's own `uplink.ts`
 * re-evaluating (HMR, a test re-importing the module after `resetModules`)
 * is a benign, common case for a single-owner declaration, there is no
 * cross-package collision risk to guard against the way there is for widget
 * ids shared across a flat namespace.
 */
export function defineUplinkClient(cfg: {
  id: string;
  version: string;
  name: string;
  description?: string;
}): UplinkClientHandle {
  const handle: UplinkClientHandle = Object.freeze({
    id: cfg.id,
    version: cfg.version,
    name: cfg.name,
    description: cfg.description,
    registerRootProvider(def: RootProviderDefinition): void {
      registerRootProvider({ ...def, id: `${cfg.id}:${def.id}` });
    },
    registerRevealedEventSource(def: RevealedEventSourceDefinition): void {
      registerRevealedEventSource({ ...def, id: `${cfg.id}:${def.id}` });
    },
    registerContribution<
      Slot extends string,
      const Deps extends readonly ContributionDep[] = readonly [],
    >(def: Omit<ContributionDefinition<Slot, Deps>, "owner">): void {
      registerContribution({
        ...def,
        id: `${cfg.id}:${def.id}`,
        owner: handle,
      });
    },
    registerProcessor<
      const Deps extends readonly Dep[],
      Result,
      const ProcessorId extends string,
    >(def: {
      id: ProcessorId;
      deps: Deps;
      compute: (values: ResolvedDeps<Deps>, frame: ProcessorFrame) => Result;
    }): ProcessorHandle<
      Result,
      `${string}:${ProcessorId}`,
      CarriesCurrency<Deps>
    > {
      return defineProcessor({ ...def, owner: cfg.id });
    },
    registerReckoner<
      const Topic extends TopicId,
      Projection = TopicPayload<Topic>,
      const Deps extends readonly Dep[] = readonly Dep[],
      const Windows extends DepWindows<Deps> = Record<never, never>,
    >(
      topic: Topic,
      reckoner: ReckonerDefinition<
        TopicPayload<Topic>,
        Projection,
        Deps,
        Windows
      >,
    ): void {
      registerReckoner(topic, cfg.id, reckoner);
    },
    registerDerivedChannel<Payload>(
      def: DerivedChannelDefinition<Payload>,
    ): void {
      contributeDerivedChannel(def, cfg.id);
    },
  });
  clients().set(handle.id, handle);
  return handle;
}

/** Reserved handle for built-in (packages/core, packages/components) contributions. */
export const CORE_UPLINK_CLIENT: UplinkClientHandle = defineUplinkClient({
  id: "core",
  version: "0.0.0",
  name: "Gonogo Core",
});

/** Every declared Uplink client, in registration order. */
export function getUplinkClients(): UplinkClientHandle[] {
  return Array.from(clients().values());
}

/** Remove every declared client. For use in tests only. */
export function clearUplinkClients(): void {
  clients().clear();
}
