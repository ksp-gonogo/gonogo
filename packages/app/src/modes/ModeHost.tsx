import { logger } from "@ksp-gonogo/logger";
import {
  type ModeLayer,
  modeFrames,
  recordedModeFrames,
  setModeLayer,
  useTelemetryClientOptional,
} from "@ksp-gonogo/sitrep-client";
import {
  getModeSource,
  type ModeSourceOutput,
  Staleness,
} from "@ksp-gonogo/sitrep-sdk";
import { sendModeCommand, useModeState } from "@ksp-gonogo/sitrep-sdk/spine";
import { useEffect } from "react";

/** The part of the peer host the mode host sends through. */
interface LayerRelay {
  setModeLayer(layer: ModeLayer | null): void;
}

/**
 * Runs the source of the mode the dashboard is in, on the main screen. What
 * the source publishes becomes this screen's mode layer, is sent to every
 * station through `relay`, and its range is told to the mod, which holds the
 * timeline. Mount it once, inside the telemetry provider. In live mode, or in
 * a mode with no source registered, it holds nothing.
 */
export function ModeHost({ relay }: { relay?: LayerRelay }) {
  const client = useTelemetryClientOptional();
  const state = useModeState();
  const mode = state?.mode;
  const entry = state ? Number(state.entry) : undefined;
  const modelled = state?.modelled === true;
  const inputsKey = JSON.stringify(state?.inputs ?? []);

  useEffect(() => {
    if (!client || !mode || entry === undefined || mode === "live") return;
    const source = getModeSource(mode);
    if (!source) return;
    const inputs = Object.fromEntries(
      (JSON.parse(inputsKey) as { key: string; value: string }[]).map((i) => [
        i.key,
        i.value,
      ]),
    );

    const publish = (output: ModeSourceOutput): string | undefined => {
      const built = modeFrames(mode, output.samples);
      if ("refused" in built) {
        logger.warn(`[modes] ${mode} source refused: ${built.refused}`);
        return built.refused;
      }
      const layer: ModeLayer = {
        mode,
        entry,
        modelled,
        frames: [
          ...recordedModeFrames(mode, output.frames ?? []),
          ...built.frames,
        ],
      };
      setModeLayer(layer);
      relay?.setModeLayer(layer);
      sendModeCommand(client, "mode.timeline.setRange", {
        mode,
        startUt: output.startUt,
        endUt: output.endUt,
        launchUt: output.launchUt ?? null,
        marks: output.marks ?? [],
        rates: [...(output.rates ?? [])],
        noTimeline: output.noTimeline ?? "",
      });
      return undefined;
    };

    const stop = source.start({
      inputs,
      watch: (topic, onValue) =>
        client.subscribeFrames(topic, (payload, meta) =>
          onValue(
            payload,
            meta?.validAt,
            (meta?.staleness ?? Staleness.Fresh) === Staleness.Fresh,
          ),
        ),
      publish,
    });
    return () => {
      stop();
      setModeLayer(undefined);
      relay?.setModeLayer(null);
    };
  }, [client, relay, mode, entry, modelled, inputsKey]);

  return null;
}
