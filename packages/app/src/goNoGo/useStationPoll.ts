import {
  registerActionHandler,
  unregisterActionHandler,
  useGameContext,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { useEffect, useRef, useState } from "react";
import type { PeerClient } from "../peer/PeerClientContext";
import type { GoNoGoNotice } from "./notice";
import { VOTE_INSTANCE_ID } from "./voteInput";

/** One station's part in the poll, as its header draws it. */
export interface StationPoll {
  /** The vote this station holds while it is in the poll. */
  vote: "go" | "no-go";
  /** False while the main screen has not approved this station: its vote goes nowhere. */
  inPoll: boolean;
  /** True while the flight scene is loaded and the poll is open: the vote button is drawn. */
  voting: boolean;
  /** True after liftoff, until the craft is back on the pad: the abort is offered. */
  launched: boolean;
  /** The station that aborted this flight, once the craft has taken the abort. */
  abortedBy: string | null;
  /** The T-0 instant on this screen's clock while a countdown runs. */
  countdownT0: number | null;
  notice: GoNoGoNotice | null;
  /** The action fired at T-0, `null` for none, `undefined` until the main screen has said. */
  onGoLabel: string | null | undefined;
  toggleVote: () => void;
  abort: () => void;
}

/**
 * This screen's vote in the main screen's GO/NO-GO poll, kept for as long as
 * the screen is open. Mount it once per screen: it sends the vote, answers the
 * main screen's resets and countdowns, and takes the bound key or controller
 * button for the vote and the abort.
 *
 * Outside the flight scene the screen is not in the poll, so a station
 * sitting in the editor neither holds a countdown up nor counts towards one,
 * and there is nothing to abort. The vessel's identity outlives a recovery,
 * so the scene is also what ends the abort.
 */
export function useStationPoll(client: PeerClient | null): StationPoll {
  const [onGoLabel, setOnGoLabel] = useState<string | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!client) return;
    return client.onGonogoOnGo(setOnGoLabel);
  }, [client]);
  const { inFlight } = useGameContext();
  // Launched once the view clock is past liftoff, so it runs against the same clock this screen reads everything else against. Never before the clamps release, `launchUt` being null until then.
  const identity = useTelemetry("vessel.identity");
  const launchUt =
    identity.state === "observed" || identity.state === "held"
      ? identity.value.launchUt
      : undefined;
  const viewUt = useViewUt();
  const launched =
    launchUt != null && viewUt?.minus(launchUt).greaterThan(0) === true;
  const [vote, setVote] = useState<"go" | "no-go">("no-go");
  const [approval, setApproval] = useState(() => client?.getApproval());
  useEffect(() => {
    if (!client) return;
    setApproval(client.getApproval());
    return client.onApprovalChange(setApproval);
  }, [client]);
  const inPoll = approval !== "pending" && approval !== "refused";
  const [notice, setNotice] = useState<GoNoGoNotice | null>(null);
  // Set when the host resets the poll after launch, so the vote is offered again beside ABORT until the craft is back on the pad.
  const [pollOpen, setPollOpen] = useState(false);
  const [countdownT0, setCountdownT0] = useState<number | null>(null);
  const [abortedBy, setAbortedBy] = useState<string | null>(null);
  // Whether this station pressed abort, so it can tell a main screen that restarted mid-flight.
  const iAbortedRef = useRef(false);

  const polling = inFlight && (!launched || pollOpen);
  // A launched station has left the poll: null is "not voting", where a stale NO-GO would draw a red box on the main screen.
  const effectiveVote = polling && inPoll ? vote : null;

  // Split from the lifecycle effect below so a vote flip never transiently sends null, which would cancel a countdown in flight.
  useEffect(() => {
    if (!client) return;
    client.sendGonogoVote(effectiveVote);
  }, [client, effectiveVote]);

  const effectiveVoteRef = useRef(effectiveVote);
  useEffect(() => {
    effectiveVoteRef.current = effectiveVote;
  }, [effectiveVote]);
  const launchedRef = useRef(launched);
  useEffect(() => {
    launchedRef.current = launched;
  }, [launched]);
  // Whether a vote from this screen would count at all, read by the resends below.
  const eligibleRef = useRef(inFlight && inPoll);
  useEffect(() => {
    eligibleRef.current = inFlight && inPoll;
  }, [inFlight, inPoll]);

  // Back on the pad, the abort is a fresh slate.
  useEffect(() => {
    if (!launched) {
      iAbortedRef.current = false;
      setPollOpen(false);
      setAbortedBy(null);
    }
  }, [launched]);

  useEffect(() => {
    if (!client) return;
    // A main screen that restarted has forgotten every vote, so a GO held here from before would otherwise come back as if it still stood.
    const unsubRestart = client.onHostRestart(() => {
      iAbortedRef.current = false;
      effectiveVoteRef.current = eligibleRef.current ? "no-go" : null;
      setVote("no-go");
    });
    // On hello rather than on connect, so the restart above has already cleared the vote before it is resent.
    const unsubHello = client.onHostHello(() => {
      client.sendGonogoVote(effectiveVoteRef.current);
      if (iAbortedRef.current) client.sendGonogoAbort();
    });
    return () => {
      unsubHello();
      unsubRestart();
      client.sendGonogoVote(null);
    };
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const unsubs = [
      client.onGonogoCountdownStart((t0Ms) => {
        setNotice(null);
        setCountdownT0(t0Ms);
      }),
      client.onGonogoCountdownCancel((_reason, hold) => {
        setCountdownT0(null);
        setNotice(hold ? { kind: "held", ...hold } : null);
      }),
      client.onGonogoOutcome((action, sent) =>
        setNotice({ kind: "outcome", action, sent }),
      ),
      client.onGonogoReset((reopened) => {
        // The host has forgotten every vote, and a vote already at NO-GO would not change and so would not be sent again: resend it, or this screen drops out of the poll.
        const next =
          eligibleRef.current && (reopened || !launchedRef.current)
            ? "no-go"
            : null;
        effectiveVoteRef.current = next;
        setVote("no-go");
        setCountdownT0(null);
        setNotice(null);
        setPollOpen(reopened);
        client.sendGonogoVote(next);
      }),
      client.onGonogoAbortNotify((stationName) => setAbortedBy(stationName)),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [client]);

  const toggleVote = () => {
    if (!polling || !inPoll) return;
    setVote((prev) => (prev === "go" ? "no-go" : "go"));
  };

  const abort = () => {
    if (!inFlight || !launched || !client) return;
    iAbortedRef.current = true;
    client.sendGonogoAbort();
  };

  const voteRef = useRef(vote);
  voteRef.current = vote;
  const handlersRef = useRef({ toggleVote, abort });
  handlersRef.current = { toggleVote, abort };
  useEffect(() => {
    registerActionHandler(VOTE_INSTANCE_ID, "toggle-vote", (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      handlersRef.current.toggleVote();
      return { Status: voteRef.current === "go" ? "NO-GO" : "GO" };
    });
    registerActionHandler(VOTE_INSTANCE_ID, "abort", (payload) => {
      if (payload.kind === "button" && payload.value !== true) return;
      handlersRef.current.abort();
      return { Status: "ABORTING" };
    });
    return () => {
      unregisterActionHandler(VOTE_INSTANCE_ID, "toggle-vote");
      unregisterActionHandler(VOTE_INSTANCE_ID, "abort");
    };
  }, []);

  return {
    vote,
    inPoll,
    voting: polling,
    launched: inFlight && launched,
    abortedBy,
    countdownT0,
    notice,
    onGoLabel,
    toggleVote,
    abort,
  };
}
