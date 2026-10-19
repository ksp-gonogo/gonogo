import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CommandGateReport } from "../__generated__/contract";
import { CORE_ERROR_CODES, FaultCode } from "../__generated__/error-codes";
import {
  COMMAND_LOST,
  COMMAND_REFUSED,
  classifyCommandRejection,
} from "../api/command-rejection";
import type {
  CommandFailure,
  CommandFound,
  CommandLoss,
  CommandRefusal,
  CommandStatus,
  CommandUndelivered,
  UseCommandOptions,
} from "../api/types";
import {
  type CommsDelayLike,
  currentMode,
  type DelayMode,
  type InFlightCommand,
  liveOneWaySeconds,
  type PathConnectedDuring,
  type PendingEntry,
} from "../command-delay";
import type {
  AnyCommandReply,
  CommandArgs,
  CommandId,
  CommandReply,
} from "../commands";
import type { RailTags } from "../rail-tags";
import { railTagsForCommand } from "../rail-tags";
import { type Reading, readingOf, type TopicReading } from "../reading";
import type { Value } from "../unit-system";
import {
  arrivalUtOf,
  arrivesTooLate,
  LATE_ARRIVAL_DETAIL,
  LATE_ARRIVAL_ERROR_CODE,
} from "./arrival-deadline";
import {
  type CommandGateStatus,
  hasItemVerdict,
  selectCommandGate,
  toGateStatus,
} from "./command-gate";
import { openCommandGroup } from "./command-group";
import { ROUTE_TOPIC, readRouteRows } from "./comms-route";
import {
  type CommsLinkLike,
  ConnectivityHistory,
} from "./connectivity-history";
import {
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "./context";
import {
  GATE_CHECK_COMMAND,
  GATE_CHECK_DEBOUNCE_MS,
  gateCheckKey,
  readGateCheckReply,
} from "./gate-check";
import { CommandError } from "./lifecycle";
import { useClaimCapability } from "./lock-scope";
import { commandDelayed } from "./map-command";
import { useRailRegistry } from "./rail-registry";
import { type PendingUplinkQueueLike, resolveTracked } from "./resolve-tracked";
import {
  readNextLossUt,
  type SendStatus,
  sendStatusFromRoutes,
} from "./send-status";
import { useLatestValue, useStream } from "./use-stream";
import { META_VANTAGE } from "./vantage";

export type { UseCommandOptions };
export { META_VANTAGE };

/** Shared constant so `getSnapshot` returns a referentially stable value when
 * no command has been dispatched yet, a fresh object literal here would
 * make `useSyncExternalStore` believe the snapshot changes on every render
 * and loop forever. */
const IDLE: CommandStatus = { phase: "idle" };

/** Shared constant for the same reason as `IDLE` above, an empty `inFlight`
 * array must be referentially stable across renders that have nothing
 * in-flight, or every consumer re-renders needlessly. */
const NO_IN_FLIGHT: InFlightCommand[] = [];

/** Same reason as `NO_IN_FLIGHT`: a fresh `[]` per render would re-render every
 *  consumer of a hook that has refused nothing, which is nearly all of them. */
const NO_REFUSALS: CommandRefusal[] = [];

/** Same reason as `NO_REFUSALS`. */
const NO_LOSSES: CommandLoss[] = [];

/** Same reason as `NO_REFUSALS`, and this one is empty for nearly every hook
 *  that ever runs: a found needs a loss to have happened first. */
const NO_FOUNDS: CommandFound[] = [];

/** Same reason as `NO_REFUSALS`. Empty unless a transport gave up on a link
 *  entirely, which is once per outage that never ends. */
const NO_UNDELIVERED: CommandUndelivered[] = [];

/** Same reason as `NO_REFUSALS`. Empty unless the mod answered a dispatch with a fault. */
const NO_FAILURES: CommandFailure[] = [];

const MOD_FAULTS: ReadonlySet<string> = new Set(
  CORE_ERROR_CODES.filter((d) => d.kind === "fault" && d.origin === "mod").map(
    (d) => d.id,
  ),
);

/** Whether `code` is a fault the mod itself answers with, rather than one this client mints about its own link. */
function isModFault(code: string): boolean {
  return MOD_FAULTS.has(code);
}

/**
 * The dispatch handle: send the command, read its status, and see the commands
 * still in flight. Useful for showing the operator whether a command has been
 * sent, confirmed or refused. Returned by {@link useCommand} and taken by the
 * panel's delay rail controls. `Args` and `Reply` come from the generated command
 * map when the hook was given a known `CommandId`.
 *
 * `Reply` falls back to {@link AnyCommandReply}, the result envelope, rather than
 * to `unknown`: it is what a handle addressed by a computed string, or reached
 * through a prop declared bare, still knows about its own answer. `Args` has no
 * such floor and stays `unknown`, because there is nothing every command's
 * arguments have in common.
 *
 * `send` is declared method-style rather than as a property holding a function.
 * That is what makes a typed handle assignable to the bare `UseCommandResult` that
 * every delay-rail control takes. As a property, `strictFunctionTypes` checks the
 * parameter contravariantly and a typed handle would no longer be assignable.
 */
export interface UseCommandResult<Args = unknown, Reply = AnyCommandReply> {
  /**
   * Sends the command. Resolves with the reply once the command has run.
   * Rejects when the game refuses it, and when no reply arrives by the expected
   * time. A refusal or loss from a `send` whose promise nobody awaits is still
   * recorded in `refusals` or `losses`.
   *
   * `opts.label` is a description of this dispatch to show the operator.
   * `opts.topic` addresses the command to one part or route on the craft, such
   * as one script terminal.
   */
  send(args?: Args, opts?: { label?: string; topic?: string }): Promise<Reply>;
  /** The state of the latest dispatch. See {@link CommandStatus}. */
  status: CommandStatus;
  /**
   * Every dispatch from this handle still travelling or awaiting its reply. An
   * entry that is overdue or lost stays until dismissed; one that has arrived
   * on a connected path is dropped.
   */
  inFlight: InFlightCommand[];
  /**
   * How the command travels, as its Uplink declared it. {@link CommandDelay}
   * chooses how to draw the command from these.
   */
  tags: RailTags;
  /**
   * The command's effective one-way delay under its vantage: `0` for a
   * never-delayed sim-meta command (`time.*`) and `0` at the meta-vantage, both
   * instant by construction, and the live `comms.delay` one-way otherwise.
   * `<CommandDelay>` renders nothing at 0.
   *
   * `null` when there is no live one-way delay to have: no measurable path
   * home, a malformed reading, or no `comms.delay` reading at all. It is never
   * 0 for those. A 0 says the command arrives now, which for a craft nothing
   * can reach is the one wrong answer that reads as everything being fine.
   * {@link delayMode} says which of them it is.
   */
  effectiveDelaySeconds: number | null;
  /**
   * The one-way delay as the reading it arrived in, for drawing a delay figure
   * through `<Unit>`: a `comms.delay` that has gone quiet draws held. `null`
   * for an instant command and wherever {@link effectiveDelaySeconds} is
   * `null`.
   */
  delayReading: Reading<Value<"s">> | null;
  /**
   * What the connection from the command centre to the vessel is doing, from
   * `comms.delay`: `"live"` under the staged threshold, `"staged"` above it,
   * `"no-path"` when nothing measurable is reported.
   *
   * `null` until a `comms.delay` reading arrives, which is not the same as
   * `"no-path"`. It does not stop {@link send}: a command sent with no path is
   * reported in {@link losses}.
   */
  delayMode: DelayMode | null;
  /**
   * What an order sent now would do, from the sending centre's `comms.route`
   * prediction: it goes at once, is held for a predicted contact and arrives at
   * a stated time, or has no route. An advisory, never a gate: it does not
   * decide whether {@link send} dispatches. `undefined` for an instant command
   * and while no route is known for the sending centre.
   */
  sendStatus: SendStatus | undefined;
  /**
   * Removes the dispatch with this id from `inFlight`, `refusals`, `losses`,
   * `founds`, `undelivered` or `failures`. Dismissing it anywhere, such as from
   * the panel's delay rail, removes it here too.
   */
  dismiss: (id: string) => void;
  /**
   * Whether this handle is registered with the panel's command rail, which then
   * speaks and draws its outcomes. `false` for a handle made with `rail: false`
   * or with no rail above it. A control that would otherwise stay quiet beside
   * a rail reads it, so an outcome is never left with nobody to say it.
   */
  railed: boolean;
  /** Dispatches the game refused, newest last, each with its reason. */
  refusals: CommandRefusal[];
  /**
   * Dispatches that got no reply, newest last. The command may still have run,
   * so sending it again may run it twice.
   */
  losses: CommandLoss[];
  /**
   * Dispatches that were reported lost and then answered after all, newest last.
   * An entry here has left `losses`. The command ran, so sending it again would
   * run it twice. See `CommandFoundOutcome` for what each outcome means.
   */
  founds: CommandFound[];
  /**
   * Dispatches that never left the operator's machine, newest last: the
   * connection stayed down until the transport gave up. An entry here has left
   * `losses`. The command did not run, so it is safe to send again once there
   * is a connection.
   */
  undelivered: CommandUndelivered[];
  /**
   * Every dispatch from this hook the mod answered with a fault rather than a
   * reply, newest last, until the operator clears it with the same `dismiss`:
   * it expired or was cancelled on its way, a continuous input was dropped
   * where it would have waited, or a game load undid it. The mod said what
   * became of it, so it is neither a loss, which knows nothing, nor a refusal,
   * which is the game's verdict on the command. None of them ran.
   */
  failures: CommandFailure[];
  /**
   * What the mod says about this command before anyone presses anything: the
   * standing verdict of its declared gates, off `system.uplink.gates`.
   *
   * `undefined` when the command declares no gates, or the stream is not
   * carrying the channel, or nothing is connected. All three mean the same
   * thing to a control (nothing is known in advance), which is where every
   * control was before the channel existed, so a control that ignores this
   * field behaves exactly as it did.
   *
   * A `blocked` gate is a reason to draw the control dark and say why. It is
   * not a reason to make it unpressable and silent: see `CommandButton`.
   * While it blocks, `send` refuses locally with the gate's own reason and
   * dispatches nothing.
   */
  gate?: CommandGateStatus;
  /**
   * The standing verdict for a call with these arguments: the verdict the mod
   * published for the item they name, when the gate depends on which item that
   * is, else {@link gate}.
   *
   * A control that sends arguments draws itself from this rather than from
   * `gate`, so the one facility the career cannot afford goes dark while the
   * rest stay live. `send` refuses locally on the same answer.
   */
  // A method rather than a function-valued property, so a typed handle stays assignable to the bare one.
  gateFor(args: Args): CommandGateStatus | undefined;
  /**
   * Asks the mod what this command's gate says about a call with these
   * arguments, from this hook's command centre, without sending it. Answers
   * what {@link gate} and {@link gateFor} cannot: a verdict that depends on a
   * choice the operator is making (a launch site, a time warp rate) or on the
   * centre they send from.
   *
   * Call it when the choice changes. It waits for a pause before asking, so a
   * form can call it on every keystroke and the mod is asked once about the
   * last value. The answer lands in {@link gateFor} for those same arguments
   * and for nothing else, so a verdict never outlives the choice it was about;
   * until it arrives, and whenever the mod cannot answer, `gateFor` says what it
   * said before. A `blocked` answer is drawn like any other gate, dark with the
   * mod's own reason. The dispatch remains the authority.
   *
   * Resolves with the verdict, or `undefined` when a later call replaced this
   * one or the mod could not answer.
   *
   * Every handle `useCommand` returns carries it. It is optional so that a
   * handle written by hand, such as a test double, need not supply one.
   */
  check?(args?: Args): Promise<CommandGateStatus | undefined>;
}

/**
 * The handle for a named command, with both its argument type and its reply type
 * resolved out of the generated command map. Useful for typing a prop, a field or
 * a helper that passes a dispatch handle around. `useCommand("...")` already
 * returns this. It takes a union of command ids as readily as one id, so a family
 * of writes that answer alike can be declared once:
 * `UseCommandResultFor<"vessel.control.setSas" | "vessel.control.setRcs">`.
 *
 * An Uplink reaches this the same way it reaches `useCommand`, off the published
 * SDK root, and its own augmented `CommandArgsMap` keys work here with nothing
 * extra registered.
 *
 * It is not named `CommandHandle`, which is already a different type on
 * `@ksp-gonogo/ui-kit`'s delay rail, imported in the same file by an Uplink.
 */
export type UseCommandResultFor<Command extends CommandId> = UseCommandResult<
  CommandArgs<Command>,
  CommandReply<Command>
>;

/**
 * Sends `command` to the mod through the nearest `TelemetryProvider` and reflects
 * its progress (`idle`, `in-flight`, then `confirmed` or `failed`). Useful for a
 * control that sends a command and shows the operator the delay before it takes
 * effect. Used by command widgets, and its handle is what {@link CommandButton}
 * takes.
 *
 * The hook also holds the set of dispatches still in flight (`inFlight`), so a
 * command widget gets delay state from the same hook it already calls to dispatch,
 * with no separate opt-in. `send` can be called more than once; any status change
 * for the active request re-renders the caller. `inFlight` accumulates every
 * pending dispatch, not only the latest: see `UseCommandResult.inFlight`.
 *
 * A known `CommandId` resolves its args and its reply out of the generated command
 * map; anything else, such as a computed id or a dynamic per-subject command, keeps
 * the untyped handle. See the `useCommand` re-export in `../api` for the author's
 * account of that split.
 */
export function useCommand<Command extends CommandId>(
  command: Command,
  options?: UseCommandOptions,
): UseCommandResult<CommandArgs<Command>, CommandReply<Command>>;
export function useCommand<Args = unknown, Reply = AnyCommandReply>(
  command: string,
  options?: UseCommandOptions,
): UseCommandResult<Args, Reply>;
export function useCommand(
  command: string,
  options?: UseCommandOptions,
): UseCommandResult {
  const vantage = options?.vantage;
  useClaimCapability("command", command);
  // Degrade gracefully with no `TelemetryProvider` mounted (disconnected).
  // Status stays IDLE and `send` is a no-op: you can't dispatch a command with
  // no link, and the hook must not throw just because the dashboard rendered
  // before a connection exists.
  const client = useTelemetryClientOptional();
  const [requestId, setRequestId] = useState<string | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      client ? client.subscribeStore(onStoreChange) : () => {},
    [client],
  );

  /*
   * The client drops the record of an answered command once a control stream
   * has sent enough newer ones, after which `getCommand` reads `idle` for an id
   * this hook did send. The last answer seen for the id stands in for it.
   */
  const lastSeenRef = useRef<{
    client: object;
    id: string;
    status: CommandStatus;
  } | null>(null);
  const getSnapshot = useCallback(() => {
    if (!client || !requestId) return IDLE;
    const current = client.getCommand(requestId);
    if (current.phase !== "idle") {
      lastSeenRef.current = { client, id: requestId, status: current };
      return current;
    }
    const last = lastSeenRef.current;
    return last?.client === client && last.id === requestId
      ? last.status
      : current;
  }, [client, requestId]);

  const status = useSyncExternalStore(subscribe, getSnapshot);

  // --- inFlight bookkeeping: this hook's OWN dispatches, retained past a
  // queue age-out (Task 4 / Task 4a of the delayed-command-ux plan). ---
  const [dispatchedIds, setDispatchedIds] = useState<string[]>([]);
  // Ids the operator has cleared from `inFlight` (a dead command's manual out).
  // Pruned once the id leaves the underlying set anyway, so it can't grow
  // unbounded over a long session.
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  // Refusals this hook has collected, accumulated on the dispatch promise's own
  // rejection rather than derived from `status`. Status only ever tracks the
  // LATEST requestId, so a widget that fires twice would lose the first
  // refusal, and a refusal is terminal so there is nothing to re-derive it from
  // later.
  const [refusals, setRefusals] = useState<CommandRefusal[]>(NO_REFUSALS);
  // Dispatches nothing ever answered. Accumulated on the promise's own `lost`
  // rejection for the same reason `refusals` is: `status` tracks only the
  // LATEST requestId, and a loss is terminal so there is nothing to re-derive
  // it from later.
  const [losses, setLosses] = useState<CommandLoss[]>(NO_LOSSES);
  // Losses this hook has since seen answered. Promoted out of `losses` by the
  // sweep effect below rather than accumulated on the promise, because the
  // promise settled as lost and never settles again: the client's own status
  // store is the only channel a late reply moves.
  const [founds, setFounds] = useState<CommandFound[]>(NO_FOUNDS);
  // Dispatches that never left this machine. Fed from BOTH channels, because
  // the news arrives at whichever of the two a given dispatch was waiting on:
  // the promise's own rejection when the command was still in flight, and the
  // sweep below when the loss timer had already settled it (that promise is
  // spent, exactly as it is for a found).
  const [undelivered, setUndelivered] =
    useState<CommandUndelivered[]>(NO_UNDELIVERED);
  const [failures, setFailures] = useState<CommandFailure[]>(NO_FAILURES);
  const entryCacheRef = useRef<Map<string, PendingEntry>>(new Map());
  const firstSeenAtRef = useRef<Map<string, number>>(new Map());
  const connectivityHistoryRef = useRef<ConnectivityHistory>(
    new ConnectivityHistory(),
  );

  const queue = useLatestValue<PendingUplinkQueueLike>("system.uplink.pending");
  // Memoised on the report identity so a control does not re-render on every
  // unrelated render of its widget. The report is republished whole at the
  // engine's gate cadence, and every `useCommand` in the tree reads the same one.
  const gateReport = useLatestValue<CommandGateReport>("system.uplink.gates");
  const gate = useMemo(
    () => selectCommandGate(gateReport, command),
    [gateReport, command],
  );
  // Read by `send`, which is keyed on the command alone and so cannot close over the render's report.
  const gateReportRef = useRef(gateReport);
  gateReportRef.current = gateReport;
  const [checked, setChecked] = useState<
    | {
        key: string;
        status: CommandGateStatus;
        report: CommandGateReport | undefined;
      }
    | undefined
  >();
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const checkSeqRef = useRef(0);
  const checkSupersededRef = useRef<(() => void) | undefined>();
  const gateFor = useCallback(
    (args: unknown) => {
      const published = selectCommandGate(gateReport, command, args);
      const answered =
        checked && checked.key === gateCheckKey(args)
          ? checked.status
          : undefined;
      /*
       * A refusal about an item the engine also publishes holds only until the
       * engine publishes again: the state it was about (a pad, a vehicle)
       * changes with no change of arguments, and the report that follows is the
       * engine's current word on that item. A refusal about arguments the report
       * does not name has no other source, and stands.
       */
      const superseded =
        checked?.report !== gateReport &&
        hasItemVerdict(gateReport, command, args);
      return answered?.blocked && !superseded
        ? answered
        : (published ?? answered);
    },
    [gateReport, command, checked],
  );
  const check = useCallback(
    (args?: unknown): Promise<CommandGateStatus | undefined> => {
      checkSeqRef.current += 1;
      const seq = checkSeqRef.current;
      clearTimeout(checkTimerRef.current);
      checkSupersededRef.current?.();
      return new Promise((resolve) => {
        if (!client) {
          resolve(undefined);
          return;
        }
        checkSupersededRef.current = () => resolve(undefined);
        checkTimerRef.current = setTimeout(() => {
          checkSupersededRef.current = undefined;
          const { result } = client.dispatch(
            GATE_CHECK_COMMAND,
            { command, args: args ?? {} },
            undefined,
            undefined,
            vantage,
          );
          result
            .then(readGateCheckReply, () => undefined)
            .then((verdict) => {
              if (seq !== checkSeqRef.current) {
                resolve(undefined);
                return;
              }
              const status = verdict && toGateStatus(verdict, command);
              setChecked(
                status
                  ? {
                      key: gateCheckKey(args),
                      status,
                      report: gateReportRef.current,
                    }
                  : undefined,
              );
              resolve(status);
            });
        }, GATE_CHECK_DEBOUNCE_MS);
      });
    },
    [client, command, vantage],
  );
  // An answer is about one command from one centre, and a pending ask is about the same.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the identity of the asker is the trigger
  useEffect(() => {
    setChecked(undefined);
    return () => {
      checkSeqRef.current += 1;
      clearTimeout(checkTimerRef.current);
      checkSupersededRef.current?.();
      checkSupersededRef.current = undefined;
    };
  }, [client, command, vantage]);
  const localRefusalSeqRef = useRef(0);
  /*
   * Whether a tracked dispatch has been settled by something other than
   * silence, which is what separates a command that arrived from one nobody
   * ever heard. Read off the client's own record for the request: `in-flight`
   * and `lost` are the absence of an answer, and every other phase is one,
   * a refusal, a late reply and a command that never left included. An `idle`
   * record for an id this hook sent is one the client dropped after it was
   * answered, since only answered records are dropped.
   */
  const acknowledged = useCallback(
    (id: string) => {
      const phase = client?.getCommand(id).phase;
      return phase !== undefined && phase !== "in-flight" && phase !== "lost";
    },
    [client],
  );
  /*
   * A primitive fingerprint of those phases, read through the same store
   * subscription, purely so an answer landing for an OLDER dispatch re-renders
   * this hook. `status`'s own snapshot tracks only the latest requestId, so
   * `useSyncExternalStore` bails out of the re-render when the one before it
   * settles, and the prune below would then run on a stale reading.
   */
  const judgedLost = useCallback(
    (id: string) => client?.getCommand(id).phase === "lost",
    [client],
  );
  const ackPhases = useSyncExternalStore(
    subscribe,
    useCallback(
      () =>
        dispatchedIds
          .map((id) => client?.getCommand(id).phase ?? "idle")
          .join(","),
      [client, dispatchedIds],
    ),
  );

  const connectivity = useLatestValue<CommsLinkLike>("comms.link");
  const commsDelay = useLatestValue<CommsDelayLike>("comms.delay");
  const commsDelayReading = useStream<CommsDelayLike>("comms.delay");

  /*
   * The delay display + effective delay this command hands to `<CommandDelay>`.
   * `tags` is a pure function of the command id: the three axes as the
   * command's owning assembly declared them.
   *
   * `effectiveDelaySeconds` is 0 for a never-delayed sim-meta command
   * (`time.*`) and for a meta-vantage dispatch, both of which are instant
   * server-side and so are knowably zero. Otherwise it is the live one-way
   * delay, and `null` whenever there is no live one-way delay to have: a
   * `comms.delay` reporting no measurable path home, a malformed or non-finite
   * one, or no `comms.delay` reading at all because the widget does not carry
   * the topic.
   *
   * A zero is NOT the fallback for any of those. `comms.delay.oneWaySeconds`
   * splits "no path home" from "the delay feature is off and the craft is
   * connected" by that value alone (`Sitrep.Contract/Comms.cs:CommsDelay`), and
   * collapsing the first onto the second clocked a craft nothing could reach as
   * if it were on the LAN. `delay-authority.ts` reads the same payload the same
   * value-first way and names zero the one direction this must never fail in.
   */
  const tags = railTagsForCommand(command);
  const isInstant = !commandDelayed(command) || vantage === META_VANTAGE;
  const isInstantRef = useRef(isInstant);
  isInstantRef.current = isInstant;
  const effectiveDelaySeconds = isInstant ? 0 : liveOneWaySeconds(commsDelay);
  const delayReading =
    isInstant || effectiveDelaySeconds === null
      ? null
      : oneWayReading(commsDelayReading);
  /*
   * The three-valued answer the package already computes, passed through rather
   * than re-derived, so a widget can SAY "no path" instead of inferring it from
   * a number that cannot express it. `null` is the fourth state and the one
   * `DelayMode` deliberately has no token for: nothing has been read, which is
   * not the same claim as "there is no path" and must not be dressed up as one.
   */
  const delayMode = commsDelay ? currentMode(commsDelay) : null;
  // A synchronous, NON-subscribing read of the same undelayed clock
  // `useUtNow` tracks (`ViewClock.utNowEstimate()`): deliberately NOT
  // `useUtNow()` itself, which subscribes to a real-wall-clock ~16ms tick
  // for the component's whole mounted lifetime. That per-frame subscription
  // is unnecessary here: `nowUt` only needs to be fresh AT the renders this
  // hook already causes (a queue/connectivity change, a status transition),
  // and the visual per-second countdown smoothing is `InFlightList`'s own
  // `useCountdown` value-hook's job, not this hook's. Avoiding the
  // independent real-timer subscription also avoids a real hazard it
  // otherwise creates: under load, that timer can fire outside any test's
  // `act()` boundary for every mounted `useCommand` caller, regardless of
  // whether the test ever touches `inFlight`.
  const store = useTelemetryStoreOptional();
  const nowUt = store?.clock.utNowEstimate() ?? 0;
  const routePayload = useLatestValue<unknown>(ROUTE_TOPIC);
  const nextLossPayload = useLatestValue<unknown>("comms.nextLoss");
  const sendStatus = isInstant
    ? undefined
    : sendStatusFromRoutes(
        readRouteRows(routePayload),
        nowUt,
        vantage,
        readNextLossUt(nextLossPayload),
      );

  if (typeof connectivity?.connected === "boolean") {
    connectivityHistoryRef.current.record(nowUt, connectivity.connected);
  }

  const pathConnectedDuring: PathConnectedDuring = useCallback(
    (fromUt: number, toUt: number) =>
      connectivityHistoryRef.current.connectedDuring(fromUt, toUt),
    [],
  );

  // Latest `nowUt` by ref, read from `send` below. That `send` is a stable
  // `useCallback` keyed on `[client, command]` alone, so it cannot close over
  // the freshly-computed render-scope value.
  const nowUtRef = useRef(nowUt);
  nowUtRef.current = nowUt;
  const nowWall = store?.clock.wallNow() ?? performance.now() / 1000;
  const nowWallRef = useRef(nowWall);
  nowWallRef.current = nowWall;
  // The clock and the command's delay, for `send` to judge arrival at the moment it is called.
  const storeRef = useRef(store);
  storeRef.current = store;

  /*
   * Every handle is registered with the nearest command rail, which draws its
   * outcomes. A dispatch with no rail above it would be seen by nobody, so a
   * dev build throws on the first one; `rail: false` is for a hook that draws
   * the outcome itself.
   */
  const rail = useRailRegistry();
  const railed = options?.rail !== false;
  const railId = useId();
  const railVerifiedRef = useRef(false);
  const [dispatchTick, setDispatchTick] = useState(0);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (dispatchTick === 0 || railVerifiedRef.current) return;
    if (railed && !rail) {
      throw new Error(
        `useCommand(${JSON.stringify(command)}).send() dispatched a command ` +
          "with no command rail mounted above it, so its outcome would reach " +
          "nobody. Mount the widget inside a DelayRailProvider: the dashboard, " +
          "renderWidget and the test render all do.",
      );
    }
    railVerifiedRef.current = true;
  }, [dispatchTick, command, rail, railed]);

  let inFlight = NO_IN_FLIGHT;
  if (dispatchedIds.length > 0) {
    const computed: InFlightCommand[] = [];
    for (const id of dispatchedIds) {
      const resolution = resolveTracked(
        id,
        queue,
        entryCacheRef.current,
        firstSeenAtRef.current,
        nowUt,
        nowWall,
        pathConnectedDuring,
        acknowledged,
        judgedLost,
      );
      if (resolution.kind === "classified") computed.push(resolution.item);
    }
    // Hide dismissed commands. The underlying `computed` set still drives the
    // dismissed-id prune below, so a dismissed id is dropped from the set once
    // it leaves `computed` on its own.
    const visible =
      dismissedIds.length > 0
        ? computed.filter((c) => !dismissedIds.includes(c.id))
        : computed;
    if (visible.length > 0) inFlight = visible;
  }

  // Prune tracked ids once resolved/expired, so `dispatchedIds` (and the
  // caches it drives) don't grow forever over a long session. Separate from
  // the render-time `inFlight` computation above so a resolved id
  // disappears from the rendered set immediately (this render) even before
  // the prune effect commits the smaller tracked-id array (next render).
  //
  // Deliberately NOT keyed on `nowUt`: reading `store.clock.utNowEstimate()`
  // synchronously (see above) means `nowUt` is a fresh value on literally
  // EVERY render, for ANY reason, keying this effect on it would refire
  // the prune on every single render of every mounted `useCommand` caller,
  // whether or not anything relevant changed. The render-time `inFlight`
  // computation above already hides a resolved entry immediately using the
  // current `nowUt`, regardless of whether this effect has caught up yet,
  // this effect only needs to run when something that could change a
  // resolution actually changed (`queue`, or the connectivity history via
  // `pathConnectedDuring`'s identity), reading the latest `nowUt` off the
  // ref at that point.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ackPhases is a re-run trigger, not a body input
  useEffect(() => {
    /*
     * A dismissed dispatch is dropped outright. A command classified lost or
     * overdue never resolves on its own, so one that was only hidden would be
     * resolved again on every render for the rest of the session.
     */
    const dismissed = dismissedIds;
    setDispatchedIds((prev) => {
      const keep = prev.filter((id) => {
        if (dismissed.includes(id)) return false;
        const resolution = resolveTracked(
          id,
          queue,
          entryCacheRef.current,
          firstSeenAtRef.current,
          nowUtRef.current,
          nowWallRef.current,
          pathConnectedDuring,
          acknowledged,
          judgedLost,
        );
        return (
          resolution.kind === "classified" || resolution.kind === "waiting"
        );
      });
      return keep.length === prev.length ? prev : keep;
    });
    setDismissedIds((prev) => {
      if (prev.length === 0) return prev;
      const keep = prev.filter((id) => !dismissed.includes(id));
      return keep.length === prev.length ? prev : keep;
    });
    /*
     * `ackPhases` is a re-run TRIGGER, not a value read in the body: a response
     * landing for a tracked dispatch changes what resolves, exactly as a queue
     * snapshot does.
     */
  }, [
    queue,
    pathConnectedDuring,
    acknowledged,
    judgedLost,
    ackPhases,
    dismissedIds,
  ]);

  /*
   * Forget what was kept for a dispatch once it is no longer tracked. Only an
   * id that was tracked on the last commit is dropped: a dispatch writes its
   * first-seen time before its id reaches `dispatchedIds`, so an id that has
   * never been in the list is one that is about to be.
   */
  const trackedBeforeRef = useRef<readonly string[]>(dispatchedIds);
  useEffect(() => {
    for (const id of trackedBeforeRef.current) {
      if (dispatchedIds.includes(id)) continue;
      entryCacheRef.current.delete(id);
      firstSeenAtRef.current.delete(id);
    }
    trackedBeforeRef.current = dispatchedIds;
  }, [dispatchedIds]);

  /*
   * Promote a loss the client has since heard back about, or learned never
   * left.
   *
   * Driven off `client.subscribeStore` and not off the dispatch promise, and
   * that is the crux of the whole feature. The promise is a one-shot await that
   * already rejected as `E_LOST`, honestly, and it never settles twice; the
   * client's per-request status is the living state, and a late reply moves it
   * from `lost` to `found` and notifies. So this listens where the news
   * actually arrives.
   *
   * Scoped to `losses` rather than to every dispatched id on purpose: a found
   * exists only where a loss did, `losses` is retained until the operator
   * dismisses it, and `dispatchedIds` is pruned long before a late reply is
   * likely to land.
   *
   * It carries the `undelivered` promotion for the same reason and by the same
   * route: a stranded command's promise rejected as `E_LOST` long before the
   * transport gave up, so the status store is again the only channel the
   * correction arrives on.
   */
  useEffect(() => {
    if (!client || losses.length === 0) return;
    const sweep = () => {
      const promoted: CommandFound[] = [];
      const unsent: CommandUndelivered[] = [];
      for (const loss of losses) {
        const status = client.getCommand(loss.id);
        if (status.phase === "undelivered") {
          unsent.push({ ...loss, reason: status.reason });
          continue;
        }
        if (status.phase !== "found") continue;
        promoted.push(
          status.outcome === "refused"
            ? {
                ...loss,
                outcome: "refused",
                errorCode: status.errorCode,
                reason: status.reason,
                breach: status.breach,
                detail: status.detail,
              }
            : status.outcome === "errored"
              ? { ...loss, outcome: "errored", error: status.error }
              : { ...loss, outcome: "ran", result: status.result },
        );
      }
      if (promoted.length === 0 && unsent.length === 0) return;
      setLosses((prev) =>
        prev.filter(
          (l) =>
            !promoted.some((f) => f.id === l.id) &&
            !unsent.some((u) => u.id === l.id),
        ),
      );
      if (promoted.length > 0) setFounds((prev) => [...prev, ...promoted]);
      if (unsent.length > 0) {
        setUndelivered((prev) => [
          ...prev,
          // A store notify can arrive more than once for the same status, and `losses` is only filtered on the render after this one.
          ...unsent.filter((u) => !prev.some((seen) => seen.id === u.id)),
        ]);
      }
    };
    // Once up front: a reply can land between the render that read `losses` and the effect that subscribes, and a store notify for it would then be gone.
    sweep();
    return client.subscribeStore(sweep);
  }, [client, losses]);

  const dismiss = useCallback((id: string) => {
    setDismissedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    // A refusal is dropped outright rather than hidden behind `dismissedIds`.
    // That set is pruned once an id leaves the underlying in-flight set, which a
    // refused dispatch does as soon as its grace window closes, and a dismissed
    // refusal that came back would read as the game refusing a second time.
    setRefusals((prev) => {
      const keep = prev.filter((r) => r.id !== id);
      return keep.length === prev.length ? prev : keep;
    });
    // Dropped outright for the same reason a refusal is: a loss is terminal, so a dismissed one that came back would read as a second silence.
    setLosses((prev) => {
      const keep = prev.filter((l) => l.id !== id);
      return keep.length === prev.length ? prev : keep;
    });
    /*
     * Dropped outright for the third time, same reason again: a found is
     * terminal, and one that came back would read as the command answering
     * twice.
     */
    setFounds((prev) => {
      const keep = prev.filter((f) => f.id !== id);
      return keep.length === prev.length ? prev : keep;
    });
    /*
     * And a fourth time, same reason: nothing can answer a command that was
     * never sent, so a dismissed one that reappeared would be a second silence
     * about the same dispatch.
     */
    setUndelivered((prev) => {
      const keep = prev.filter((u) => u.id !== id);
      return keep.length === prev.length ? prev : keep;
    });
    setFailures((prev) => {
      const keep = prev.filter((f) => f.id !== id);
      return keep.length === prev.length ? prev : keep;
    });
  }, []);

  /*
   * Everything a dispatch needs once it has a request id: the tracking, and
   * the handling of its rejection. Run straight away for a send of its own,
   * by `sendTogether` when the group it joined has gone, and for a command an
   * earlier page of this screen sent and is still waiting on.
   */
  const trackDispatch = useCallback(
    (
      newRequestId: string,
      result: Promise<unknown>,
      args: unknown,
      label: string,
    ): Promise<AnyCommandReply> => {
      setRequestId(newRequestId);
      firstSeenAtRef.current.set(
        newRequestId,
        storeRef.current?.clock.wallNow() ?? performance.now() / 1000,
      );
      setDispatchedIds((prev) => [...prev, newRequestId]);
      // Schedule the dev-only rail check on the first unverified dispatch (see the effect above).
      if (process.env.NODE_ENV !== "production" && !railVerifiedRef.current) {
        setDispatchTick((tick) => tick + 1);
      }
      // Mark the dispatch's own rejection as HANDLED without consuming it.
      //
      // Now that a dropped command rejects, a `void`ed dispatch would raise an unhandled rejection on every lost command.
      //
      // Attaching a no-op handler here marks `result` handled while leaving the
      // rejection fully observable to anyone who awaits it: `ManeuverPlanner`'s
      // `try/catch` around `dispatchPlanBurns` still sees the throw. Swallowing it
      // instead (returning a never-rejecting promise) would have been the wrong fix,
      // because that caller is the one that NEEDS the rejection.
      result.catch((err: unknown) => {
        // ONLY a refusal. `lost` decided nothing and the command may well have
        // executed; `failed` is the machinery, which the queue and the link
        // indicators already speak for. Calling either of them a refusal would
        // be a confident wrong answer about what the game said.
        const rejection = classifyCommandRejection(err);
        // No answer arrived. Kept because the queue CANNOT show this one: a
        // comms-loss drop is refused a `PendingUplink` before it is dispatched,
        // so `inFlight` is empty and there is nothing else that knows the
        // command existed. The loss carries the command and args from this
        // closure, since a `lost` rejection has no reply to name them from.
        if (rejection.kind === "lost") {
          setLosses((prev) => [
            ...prev,
            {
              id: newRequestId,
              command,
              args,
              label: label,
            },
          ]);
          return;
        }
        // It never left this machine: the transport gave up on the link while
        // this was still waiting on it. Collected here rather than in the sweep
        // because there is no loss to promote, the deadline having never come
        // round (or never been armed). Classified `failed`, so this reads the
        // code, since nothing was decided over there and so it is not a `kind` of its own.
        if (
          rejection.kind === "failed" &&
          rejection.code === FaultCode.Undelivered
        ) {
          setUndelivered((prev) => [
            ...prev,
            {
              id: newRequestId,
              command,
              args,
              label: label,
              reason: rejection.message,
            },
          ]);
          return;
        }
        // A fault the mod answered with names what became of the command, so it is kept to be said rather than dropped with the promise.
        if (rejection.kind === "failed" && isModFault(rejection.code)) {
          setFailures((prev) => [
            ...prev,
            {
              id: newRequestId,
              command,
              args,
              label: label,
              code: rejection.code,
              reason: rejection.message,
            },
          ]);
          return;
        }
        if (rejection.kind !== "refused") return;
        setRefusals((prev) => [
          ...prev,
          {
            id: newRequestId,
            errorCode: rejection.errorCode,
            reason: rejection.reason,
            command: rejection.command ?? command,
            args: rejection.args ?? args,
            label: rejection.label ?? label,
            breach: rejection.breach,
            detail: rejection.detail,
          },
        ]);
      });
      // The one place the wire's guarantee is asserted, and the layer entitled
      // to assert it. `TelemetryClient` is transport-level and deliberately
      // knows nothing about the command contract, so it resolves `unknown`;
      // this hook is keyed on the generated command map and does. Everything
      // above this line reads the reply through `AnyCommandReply` or through a
      // named command's own type, so the assertion is made once here instead of
      // being re-made, undocumented, at every call site that wanted to read
      // something.
      return result as Promise<AnyCommandReply>;
    },
    [command],
  );

  // Commands an earlier page of this screen sent under this id and is still waiting on, taken once so their answers show as a send's own do.
  useEffect(() => {
    if (!client) return;
    for (const held of client.restoredCommands(command)) {
      trackDispatch(held.requestId, held.result, held.args, held.label);
    }
  }, [client, command, trackDispatch]);

  const send = useCallback(
    (
      args?: unknown,
      opts?: { label?: string; topic?: string },
    ): Promise<AnyCommandReply> => {
      // No provider mounted: nothing left the ground, so nothing can come back.
      //
      // Resolving with `undefined` would read as a confirmed command:
      // `CommandButton` awaits `send()`, calls `onConfirmed`, and returns to
      // rest, so a press with no link would render byte-identically to a press
      // that worked. A rejection is what the controls are built to read, and
      // it matches the client's own answer on `dispose()` and for a command
      // the engine dropped.
      if (!client) {
        const notMounted = new CommandError(
          COMMAND_LOST,
          `command ${JSON.stringify(command)} was not dispatched: no telemetry provider is mounted`,
        );
        openCommandGroup()?.poison(notMounted);
        const unsent = Promise.reject<AnyCommandReply>(notMounted);
        // Marked handled without being consumed, exactly as the dispatched
        // promise is below and for the same reason: a `void cmd.send(...)` call
        // site would otherwise raise an unhandled rejection every time it ran
        // with nothing mounted. The rejection stays fully observable to anyone
        // who awaits it.
        unsent.catch(() => undefined);
        return unsent;
      }
      /*
       * The command's own declaration already said no, so nothing is sent. The
       * refusal carries the gate's verdict and lands where a dispatched one
       * would, so every caller, not only a button, is refused the same way.
       */
      const refuseLocally = (
        verdict: Pick<
          CommandRefusal,
          "errorCode" | "reason" | "breach" | "detail"
        >,
        reason: string,
      ): Promise<AnyCommandReply> => {
        localRefusalSeqRef.current += 1;
        const refusal: CommandRefusal = {
          id: `local-refusal:${command}:${localRefusalSeqRef.current}`,
          errorCode: verdict.errorCode,
          reason: verdict.reason,
          command,
          args,
          label: opts?.label ?? "",
          breach: verdict.breach,
          detail: verdict.detail,
        };
        setRefusals((prev) => [...prev, refusal]);
        const error = new CommandError(
          COMMAND_REFUSED,
          `command ${JSON.stringify(command)} was not dispatched: ${reason}`,
          verdict.errorCode,
          refusal,
        );
        // A group goes whole or not at all, so one refused member refuses it.
        openCommandGroup()?.poison(error);
        const refused = Promise.reject<AnyCommandReply>(error);
        refused.catch(() => undefined);
        return refused;
      };
      const standing = selectCommandGate(gateReportRef.current, command, args);
      if (standing?.blocked) {
        return refuseLocally(standing, "its gate refuses it");
      }
      // A command that acts at a UT and would land at or after it is refused before it leaves.
      const clock = storeRef.current?.clock;
      const arrivalUt = clock
        ? arrivalUtOf(clock, !isInstantRef.current)
        : undefined;
      if (arrivesTooLate(command, args, arrivalUt)) {
        return refuseLocally(
          { errorCode: LATE_ARRIVAL_ERROR_CODE, detail: LATE_ARRIVAL_DETAIL },
          LATE_ARRIVAL_DETAIL,
        );
      }
      const track = (
        newRequestId: string,
        result: Promise<unknown>,
      ): Promise<AnyCommandReply> =>
        trackDispatch(newRequestId, result, args, opts?.label ?? "");
      const group = openCommandGroup();
      if (group) {
        return group.capture({
          client,
          command,
          args,
          label: opts?.label,
          topic: opts?.topic,
          vantage,
          instant: isInstantRef.current,
          track,
        });
      }
      const { requestId: newRequestId, result } = client.dispatch(
        command,
        args,
        opts?.label,
        opts?.topic,
        vantage,
      );
      return track(newRequestId, result);
    },
    [client, command, vantage, trackDispatch],
  );

  const outcome = {
    status,
    inFlight,
    refusals,
    losses,
    founds,
    undelivered,
    failures,
    tags,
    effectiveDelaySeconds,
    delayReading,
    delayMode,
    sendStatus,
    dismiss,
    gate,
  };

  // Keyed on identity only, so a moving outcome updates in place rather than re-registering.
  // biome-ignore lint/correctness/useExhaustiveDependencies: outcome changes are applied by the update effect below
  useEffect(() => {
    if (!rail || !railed) return;
    return rail.register({ id: railId, ...outcome });
  }, [rail, railed, railId]);

  // The rail's shallow-equal guard means an outcome that did not move notifies nobody.
  useEffect(() => {
    if (!rail || !railed) return;
    rail.update(railId, outcome);
  });

  return { send, gateFor, check, railed: railed && rail !== null, ...outcome };
}

/** The one-way delay off a `comms.delay` reading, with its currency; `null` where there is no finite one to draw. */
function oneWayReading(
  reading: TopicReading<CommsDelayLike>,
): Reading<Value<"s">> | null {
  if (reading.state !== "observed" && reading.state !== "held") return null;
  const oneWay = reading.value?.oneWaySeconds;
  if (!oneWay?.isFinite()) return null;
  return readingOf(reading, () => oneWay.max(0));
}
