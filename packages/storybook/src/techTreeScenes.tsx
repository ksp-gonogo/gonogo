import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProbeMount } from "../../components/scripts/probe/probe-entry";
import early from "../../components/src/TechTree/__fixtures__/early-career-63-nodes.json";
import {
  type CareerFrame,
  type CareerNode,
  nodesAt,
  playCareer,
} from "../scripts/techCareerModel";
import { PlaybackStart } from "./PlaybackStart";
import { WidgetScene } from "./WidgetScene";

/** Real milliseconds each step of the career plays for. */
const STEP_MS = 550;

interface Emit {
  channel: string;
  value: unknown;
}

interface CareerStatus {
  balances: { funds: number; reputation: number; science: number };
  contracts: unknown;
  strategies: unknown;
  tech: { nodes: CareerNode[] };
}

function isCareerStatus(v: unknown): v is CareerStatus {
  return typeof v === "object" && v !== null && "balances" in v && "tech" in v;
}

function careerStatusOf(emits: readonly { value: unknown }[]): CareerStatus {
  for (const e of emits) {
    if (isCareerStatus(e.value)) return e.value;
  }
  throw new Error("the early-career fixture carries no career.status");
}

const BASE_STATUS = careerStatusOf(early._stream.emits);
const TREE: CareerNode[] = BASE_STATUS.tech.nodes;
const SCENE: Emit = {
  channel: "spaceCenter.scene",
  value: { scene: "SpaceCenter" },
};

function careerEmit(frame: CareerFrame): Emit {
  return {
    channel: "career.status",
    value: {
      ...BASE_STATUS,
      balances: { ...BASE_STATUS.balances, science: frame.science },
      tech: {
        unlockedCount: frame.ownedIds.length,
        unlockedIds: frame.ownedIds,
        nodes: nodesAt(TREE, frame),
      },
    },
  };
}

function describe(frame: CareerFrame): string {
  if (frame.bought) return `Researched ${frame.bought.title}`;
  return frame.earned > 0
    ? `A flight returns ${frame.earned} science`
    : "A new career, nothing researched";
}

export interface TechTreeCareerSceneProps {
  w?: number;
  h?: number;
}

/**
 * Tech Tree mounted on a new career, then fed one frame after another: science
 * comes back from flights, the researchable count rises with the balance, and
 * the cheapest reachable node is bought, lighting the graph as it goes.
 * Replay starts the career over.
 */
export function TechTreeCareerScene({
  w = 24,
  h = 22,
}: TechTreeCareerSceneProps) {
  const frames = useMemo(() => playCareer(TREE), []);
  const first = useMemo(
    () => ({
      _meta: {
        scenario: "career-playback",
        synthetic: true,
        notes: "SYNTHETIC (model-generated, NOT captured).",
      },
      _stream: {
        pinnedUt: 10,
        emits: [SCENE, careerEmit(frames[0])],
      },
    }),
    [frames],
  );
  const [run, setRun] = useState(0);
  const [at, setAt] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => () => clearInterval(timer.current), []);

  const play = useCallback(
    (mount: ProbeMount) => {
      let index = 0;
      clearInterval(timer.current);
      timer.current = setInterval(() => {
        index += 1;
        const frame = frames[index];
        if (!frame) {
          clearInterval(timer.current);
          return;
        }
        const e = careerEmit(frame);
        mount.emit(e.channel, e.value);
        setAt(index);
      }, STEP_MS);
    },
    [frames],
  );

  const replay = () => {
    clearInterval(timer.current);
    setAt(0);
    setRun((n) => n + 1);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <PlaybackStart onClick={replay}>Replay</PlaybackStart>
        <span aria-live="off">
          Step {at} of {frames.length - 1}: {describe(frames[at])}
        </span>
      </div>
      <WidgetScene
        key={run}
        widgetId="tech-tree"
        fixture={first}
        w={w}
        h={h}
        onMounted={play}
      />
    </div>
  );
}
