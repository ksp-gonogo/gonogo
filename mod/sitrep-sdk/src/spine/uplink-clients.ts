import {
  type RevealedEventSourceDefinition,
  registerRevealedEventSource,
} from "../api/event-reveal";
import {
  type RootProviderDefinition,
  registerRootProvider,
} from "../api/root-providers";
import type {
  ContributionDefinition,
  ContributionDep,
  ContributionRegistry,
  ContributionSlotId,
  DepTopics,
} from "../api/types";
import { type ContractTagTable, registerContractTags } from "../contract-tags";
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
 * {@link defineUplinkClient}. Useful for putting an Uplink's widgets and
 * contributions in front of the operator under the Uplink's own name. Declare
 * one per client, in one module, and import it wherever the client registers
 * something.
 *
 * There are two ways to register, and each piece uses one of them:
 *
 * - the methods of this handle (`registerRootProvider`,
 *   `registerRevealedEventSource`, `registerContribution`, `registerProcessor`)
 *   prefix the id they are given with the Uplink's own, `my-uplink:<id>`, so two
 *   Uplinks can use the same local ids without colliding; `registerReckoner` and
 *   `registerDerivedChannel` take a Topic rather than an id of their own, and
 *   record this Uplink as its owner
 * - the free functions `registerComponent` and `registerAugment` are not methods
 *   of the handle: they take the handle as `owner` and use the id as written
 * - `registerDataSource` and `registerTheme` take no owner and use the id as
 *   written, so prefix those ids yourself
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
 * // A method of the handle: the id is registered as "my-uplink:status".
 * MY_UPLINK.registerRootProvider({
 *   id: "status",
 *   Provider: ({ children }) => <>{children}</>,
 * });
 *
 * // A free function: the handle goes in as owner and the id is used as written.
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
  /** The Uplink's id. It must match the id its mod declares with `[SitrepUplink]`, and the `id` in `uplink.json` when that file names one. */
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
  description: string;
  /**
   * Mounts a provider around every screen, so widgets that share state can
   * find it above them. See {@link RootProviderDefinition}.
   */
  registerRootProvider(def: RootProviderDefinition): void;

  /**
   * Gives an alarm's `event` trigger this Uplink's events to watch for. This
   * is the handle's form of {@link registerRevealedEventSource}: it takes the
   * same {@link RevealedEventSourceDefinition}, with the id prefixed by the
   * Uplink's id. Call this one from an Uplink's client.
   *
   * The source is asked for its events at the universal time (UT, the game
   * clock in seconds) the operator is viewing. That time lags the game under
   * signal delay, so return only the events that have happened by then.
   */
  registerRevealedEventSource(def: RevealedEventSourceDefinition): void;

  /**
   * Fills another widget's contribution slot. See {@link ContributionDefinition}
   * for what `def` holds and when `compute` runs. Throws when this Uplink has
   * already registered a contribution with the same id.
   */
  registerContribution<
    Slot extends ContributionSlotId,
    const Deps extends readonly ContributionDep[] = readonly [],
  >(
    def: Omit<ContributionDefinition<Slot, Deps>, "owner" | "compute"> & {
      compute: (
        topics: DepTopics<Deps>,
      ) =>
        | readonly (ContributionRegistry[Slot] & { entry: unknown })["entry"][]
        | null
        | undefined;
    },
  ): void;
  registerContribution<
    Slot extends string,
    const Deps extends readonly ContributionDep[] = readonly [],
  >(def: Omit<ContributionDefinition<Slot, Deps>, "owner">): void;
  /**
   * Registers a Processor, a value computed from Topics once per frame (each
   * time the dashboard's telemetry store publishes a new set of values) and
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
   * in the app rather than sent by the mod. See {@link DerivedChannelDefinition}
   * for how its `derive` reads the inputs.
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
 * What a client declares about itself: its identity, and the value tags its
 * contract's codegen wrote. Useful for naming the Uplink in the operator's widget
 * picker and settings. Taken by {@link defineUplinkClient}.
 *
 * @category Registering
 */
export interface UplinkClientConfig {
  /** The Uplink's id, as its mod half declares it. */
  id: string;
  /** The client's version, which equals the Uplink's package version. */
  version: string;
  /** The Uplink's name as the dashboard shows it. */
  name: string;
  /** What the Uplink does, in one or two sentences. See {@link UplinkClientHandle.description}. */
  description: string;
  /**
   * The value tags this Uplink's contract declares: how a value relates in
   * time, whether it identifies a list entry, and which values a forward model
   * carries on. `uplink-tools codegen` writes them as `GENERATED_CONTRACT_TAGS`
   * in `client/src/__generated__/units.ts`; pass that table here. They are
   * registered under the client's id before the handle is returned, so the
   * handle's `registerReckoner` finds the marks that let it model a value.
   */
  tags?: ContractTagTable;
}

/**
 * Declares a client's identity and records it in the client registry, returning a
 * frozen {@link UplinkClientHandle}. Useful for giving an Uplink's widgets and
 * contributions a name the operator sees. Stamp the handle as `owner` on every
 * `registerComponent` and `registerAugment` call the client makes, or call its
 * bound `registerContribution`, which stamps it for you.
 *
 * Declaring the same id again replaces the earlier declaration, as
 * `registerUplinkHandle` does, and does not throw as `registerComponent` does on
 * a collision. A client's own module re-evaluating (hot reload, a test
 * re-importing the module) is therefore harmless.
 */
export function defineUplinkClient(
  cfg: UplinkClientConfig,
): UplinkClientHandle {
  if (cfg.tags) registerContractTags(cfg.id, cfg.tags);
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

/**
 * The reserved handle for the built-in contributions of the app itself. Useful
 * for registering a contribution that belongs to no Uplink. Used by the built-in
 * widgets' contributions, such as the comm signal badge and the system diagram's
 * vessel orbits.
 */
export const CORE_UPLINK_CLIENT: UplinkClientHandle = defineUplinkClient({
  id: "core",
  version: "0.0.0",
  name: "Gonogo Core",
  description: "The widgets and contributions that ship with Gonogo itself.",
});

/**
 * Every declared Uplink client, in registration order. Useful for listing which
 * Uplinks have a client and what each registers. Used by the Uplink page
 * generator.
 */
export function getUplinkClients(): UplinkClientHandle[] {
  return Array.from(clients().values());
}

/** Remove every declared client. For use in tests only. */
export function clearUplinkClients(): void {
  clients().clear();
}
