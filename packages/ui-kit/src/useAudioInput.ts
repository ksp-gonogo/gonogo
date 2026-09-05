import { useCallback, useEffect, useRef, useState } from "react";
import { audioCaptureSupport } from "./audioCaptureSupport";

/**
 * The permission-and-selection half of microphone capture, with no opinion
 * about how any of it is drawn.
 *
 * `AudioInputPicker` is the drawn form and the usual entry point; this exists
 * separately because a host that already owns its own chrome still wants the
 * state machine, and because the state machine is the part worth testing
 * against a stubbed `navigator.mediaDevices`.
 *
 * Every outcome is a named status rather than a boolean plus an error, for the
 * reason `audioCaptureSupport()` reports a reason: a refused permission, an
 * absent device and an insecure origin all end with no stream, and an operator
 * told only that reads the wrong cause and goes after the wrong fix.
 */

/** One selectable capture device. */
export interface AudioInputDevice {
  deviceId: string;
  /**
   * The browser's name for the device. EMPTY until capture access is granted:
   * a label is fingerprinting surface, so every engine withholds it from an
   * unpermitted page. An empty label is the browser behaving correctly and
   * never a device without a name.
   */
  label: string;
}

/**
 * Where the capture attempt stands. The four terminal-ish failures are kept
 * apart because they are four different facts:
 *
 * - `insecure-origin` and `no-media-devices`: capture cannot be attempted, per
 *   `audioCaptureSupport()`
 * - `refused`: the operator (or a standing site setting) said no. The browser
 *   holds that answer for the origin, so asking again returns it without
 *   prompting
 * - `no-device`: access is not the problem, there is nothing to capture from
 * - `failed`: the device exists and is permitted, and opening it still did not
 *   work (in use elsewhere, hardware error). `failure.name` carries the
 *   browser's own word for it
 */
export type AudioInputStatus =
  | "insecure-origin"
  | "no-media-devices"
  | "unasked"
  | "requesting"
  | "refused"
  | "no-device"
  | "failed"
  | "ready";

export interface AudioInputFailure {
  /** The `DOMException` name the browser reported, e.g. `NotReadableError`. */
  name: string;
  /** The device the attempt named, or null for an unpinned first request. */
  deviceId: string | null;
}

export interface AudioInputState {
  status: AudioInputStatus;
  /**
   * Every audio input the browser will admit to. Populated before access is
   * granted on the engines that allow it, with empty labels; entries with an
   * empty `deviceId` are dropped, since they name nothing that can be opened.
   */
  devices: readonly AudioInputDevice[];
  /** The open device, null whenever no capture is running. */
  deviceId: string | null;
  /** The live stream, null whenever no capture is running. */
  stream: MediaStream | null;
  /**
   * The last attempt that did not work. Set alongside `ready` when a SWITCH
   * failed and the previous capture is still open, which is the one case where
   * a failure is not the whole state.
   */
  failure: AudioInputFailure | null;
}

export interface AudioInputControls extends AudioInputState {
  /** Open the default input, prompting for access the first time. */
  request(): Promise<void>;
  /** Open a named input, keeping the current one if the new one will not open. */
  select(deviceId: string): Promise<void>;
  /** Stop the capture and hand back a null stream. Access stays granted. */
  release(): void;
}

export interface UseAudioInputOptions {
  /**
   * Track constraints merged into every request. A `deviceId` here is
   * overwritten by the selection, which is the whole point of the picker.
   */
  constraints?: MediaTrackConstraints;
  /** Called with each stream as it opens, and with null as it closes. */
  onStream?: (stream: MediaStream | null) => void;
}

/** Option text for a device, honest about a name the browser withheld. */
export function describeAudioInput(
  device: AudioInputDevice,
  index: number,
): string {
  return device.label !== ""
    ? device.label
    : `Input ${index + 1}, name withheld`;
}

const REFUSED_ERRORS = new Set([
  "NotAllowedError",
  "PermissionDeniedError",
  "SecurityError",
]);

const ABSENT_ERRORS = new Set([
  "NotFoundError",
  "DevicesNotFoundError",
  "OverconstrainedError",
  "ConstraintNotSatisfiedError",
]);

function errorName(err: unknown): string {
  if (err instanceof Error && err.name !== "") return err.name;
  if (typeof err === "object" && err !== null && "name" in err) {
    const name = (err as { name: unknown }).name;
    if (typeof name === "string" && name !== "") return name;
  }
  return "UnknownError";
}

function statusForError(name: string): AudioInputStatus {
  if (REFUSED_ERRORS.has(name)) return "refused";
  if (ABSENT_ERRORS.has(name)) return "no-device";
  return "failed";
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function trackDeviceId(stream: MediaStream): string | null {
  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings?.();
  return settings?.deviceId ?? null;
}

async function listInputs(): Promise<AudioInputDevice[]> {
  const media = navigator.mediaDevices;
  if (!media || typeof media.enumerateDevices !== "function") return [];
  try {
    const all = await media.enumerateDevices();
    return all
      .filter(
        (device) => device.kind === "audioinput" && device.deviceId !== "",
      )
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  } catch {
    /*
     * An enumeration that throws is not a device fact, so it is reported as an
     * empty list rather than as an absent device: the request itself is still
     * the thing that decides whether capture works.
     */
    return [];
  }
}

function initialState(): AudioInputState {
  const support = audioCaptureSupport();
  return {
    status: support.supported ? "unasked" : support.reason,
    devices: [],
    deviceId: null,
    stream: null,
    failure: null,
  };
}

export function useAudioInput(
  options: UseAudioInputOptions = {},
): AudioInputControls {
  const [state, setState] = useState<AudioInputState>(initialState);
  const streamRef = useRef<MediaStream | null>(null);
  /*
   * The open device, mirrored out of state so the `devicechange` handler can
   * decide whether the capture survived without reading a `prev` it would have
   * to mutate around. The updater stays pure, which matters under StrictMode's
   * double invocation.
   */
  const openDeviceIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

  const closeStream = useCallback(() => {
    const open = streamRef.current;
    if (!open) return;
    streamRef.current = null;
    openDeviceIdRef.current = null;
    stopTracks(open);
    optionsRef.current.onStream?.(null);
  }, []);

  /*
   * A device list that no longer holds the open device is an unplug, and the
   * capture is over whether or not anything else remains: the two outcomes are
   * kept apart because "nothing to capture from" and "the input you had is
   * gone, others remain" are different facts, and only the first is a reason
   * to stop offering a choice.
   */
  const applyDevices = useCallback(
    (devices: AudioInputDevice[]) => {
      const openId = openDeviceIdRef.current;
      const lost =
        streamRef.current !== null &&
        (openId === null
          ? devices.length === 0
          : !devices.some((device) => device.deviceId === openId));
      setState((prev) => {
        if (prev.status !== "ready" || !lost) return { ...prev, devices };
        return {
          ...prev,
          status: devices.length === 0 ? "no-device" : "unasked",
          devices,
          deviceId: null,
          stream: null,
        };
      });
      if (lost) closeStream();
    },
    [closeStream],
  );

  /*
   * The device list is read once on mount and again on every `devicechange`.
   * Before access is granted this yields ids without labels on the engines
   * that publish it at all, which is enough to say how many inputs exist and
   * not enough to name one; after it is granted the same read is what fills
   * the labels in, and what notices a device being unplugged.
   */
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) return;

    let cancelled = false;
    const sync = () => {
      void listInputs().then((devices) => {
        if (!cancelled) applyDevices(devices);
      });
    };
    sync();
    media.addEventListener?.("devicechange", sync);
    return () => {
      cancelled = true;
      media.removeEventListener?.("devicechange", sync);
    };
  }, [applyDevices]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closeStream();
    };
  }, [closeStream]);

  const open = useCallback(async (deviceId: string | null) => {
    const media = navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== "function") return;

    setState((prev) => ({
      ...prev,
      status: prev.stream ? prev.status : "requesting",
      failure: null,
    }));

    const audio: MediaTrackConstraints = {
      ...optionsRef.current.constraints,
      ...(deviceId === null ? {} : { deviceId: { exact: deviceId } }),
    };

    try {
      const stream = await media.getUserMedia({ audio });
      if (!mountedRef.current) {
        stopTracks(stream);
        return;
      }
      const previous = streamRef.current;
      streamRef.current = stream;
      if (previous && previous !== stream) stopTracks(previous);

      const listed = await listInputs();
      const active = trackDeviceId(stream) ?? deviceId ?? listed[0]?.deviceId;
      const devices =
        listed.length > 0 ? listed : openDeviceOnly(stream, active);
      openDeviceIdRef.current = active ?? null;
      setState({
        status: "ready",
        devices,
        deviceId: active ?? null,
        stream,
        failure: null,
      });
      optionsRef.current.onStream?.(stream);
    } catch (err) {
      if (!mountedRef.current) return;
      const failure: AudioInputFailure = { name: errorName(err), deviceId };
      setState((prev) =>
        prev.stream
          ? { ...prev, failure }
          : {
              status: statusForError(failure.name),
              devices: prev.devices,
              deviceId: null,
              stream: null,
              failure,
            },
      );
    }
  }, []);

  const request = useCallback(() => open(null), [open]);
  const select = useCallback((deviceId: string) => open(deviceId), [open]);
  const release = useCallback(() => {
    closeStream();
    setState((prev) => ({
      ...prev,
      status: prev.status === "ready" ? "unasked" : prev.status,
      deviceId: null,
      stream: null,
    }));
  }, [closeStream]);

  return { ...state, request, select, release };
}

/**
 * The one device we can prove exists, for an engine that grants capture and
 * still enumerates nothing. Returns an empty list rather than a nameless,
 * idless row, since a row that selects nothing is worse than no row.
 */
function openDeviceOnly(
  stream: MediaStream,
  deviceId: string | null | undefined,
): AudioInputDevice[] {
  if (!deviceId) return [];
  return [{ deviceId, label: stream.getAudioTracks()[0]?.label ?? "" }];
}
