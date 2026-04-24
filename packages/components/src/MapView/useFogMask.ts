import {
  type BodyDefinition,
  imagingQuality,
  nadirNose,
  noseFromAttitude,
  paintFogDisc,
  paintFogFromBody,
} from "@gonogo/core";
import {
  DEFAULT_MASK_HEIGHT,
  DEFAULT_MASK_WIDTH,
  useBodyFogMask,
  useFogMaskCache,
} from "@gonogo/data";
import { useEffect, useRef, useState } from "react";

export type { BodyMask } from "@gonogo/data";

const PAINT_INTERVAL_MS = 500; // 2 Hz

interface UseFogPainterArgs {
  body: BodyDefinition | undefined;
  shipLat: number | undefined;
  shipLon: number | undefined;
  altitude: number | undefined;
  /** Ship pitch in degrees (Telemachus convention: -90 nadir, +90 zenith). Optional. */
  pitch: number | undefined;
  /** Ship heading in degrees (compass bearing). Optional. */
  heading: number | undefined;
  enabled: boolean;
}

/**
 * Drives the fog-of-war mask from live telemetry. Runs at most 2 Hz and
 * silently skips when quality is zero, signal is lost, or the body lacks a
 * radius. The mask mutation is cheap (byte writes); persistence is handled
 * by the cache's debounced flush.
 */
export function useFogPainter({
  body,
  shipLat,
  shipLon,
  altitude,
  pitch,
  heading,
  enabled,
}: UseFogPainterArgs): void {
  const cache = useFogMaskCache();
  const lastPaintRef = useRef<number>(0);
  const seededRef = useRef<string | null>(null);
  const { mask } = useBodyFogMask(body?.id);

  // Seed the body's starting region (e.g. KSC on Kerbin) on first mount per
  // body. paintFogDisc is max-lighten so re-running is a no-op; the ref is
  // just there to avoid the scan churn on every mask tick.
  useEffect(() => {
    if (!enabled || !cache || !body || !mask) return;
    if (!body.initialReveal) return;
    if (seededRef.current === body.id) return;
    seededRef.current = body.id;
    const rect = paintFogDisc(mask, {
      lat: body.initialReveal.lat,
      lon: body.initialReveal.lon,
      radiusMetres: body.initialReveal.radiusMetres,
      bodyRadius: body.radius,
      longitudeOffset: body.longitudeOffset ?? 0,
      latitudeOffset: body.latitudeOffset ?? 0,
      alpha: 255,
    });
    if (rect) cache.markDirty(body.id);
  }, [enabled, cache, body, mask]);

  // Per-tick paint driven by live telemetry. Deliberately not gated on
  // comm.connected — the buffered data layer already stops forwarding
  // non-comm.* samples during blackout, so lat/lon/alt simply don't change
  // and the painter idles. Gating here would additionally prevent the
  // seeded starting region from being visible when the player's vessel
  // has no antenna (e.g. pre-launch with no comm parts), which defeats
  // the point of the seed.
  useEffect(() => {
    if (!enabled || !cache) return;
    if (!body || !mask) return;
    if (
      shipLat === undefined ||
      shipLon === undefined ||
      altitude === undefined
    ) {
      return;
    }

    const now = Date.now();
    if (now - lastPaintRef.current < PAINT_INTERVAL_MS) return;

    const quality = imagingQuality(altitude, body);
    if (quality <= 0) {
      lastPaintRef.current = now;
      return;
    }

    // If attitude is missing, fall back to nadir — this is the only sensible
    // default. On atmospheric descent / pad-rest, lat/lon/alt arrive before
    // n.pitch/n.heading stabilise, and we'd rather paint something useful
    // than nothing.
    const nose =
      pitch !== undefined && heading !== undefined
        ? noseFromAttitude(shipLat, shipLon, pitch, heading)
        : nadirNose(shipLat, shipLon);

    const rect = paintFogFromBody(
      mask,
      body,
      { lat: shipLat, lon: shipLon, altitude, nose },
      quality,
    );
    lastPaintRef.current = now;
    if (rect) cache.markDirty(body.id);
  }, [enabled, body, mask, shipLat, shipLon, altitude, pitch, heading, cache]);
}

/**
 * Maintains an offscreen canvas that mirrors the fog mask, suitable for
 * drawing via drawImage into the world-space layer. Fog appears as a dark
 * overlay: alpha = 255 − maskAlpha, so fully-imaged regions are transparent
 * and un-imaged regions are opaque dark.
 *
 * Returns the canvas element and a version counter that increments on
 * every mask mutation, so the caller's render effect can key off one source
 * of truth. Exposing the canvas via useState (not useRef) means the first
 * render after the mask loads already has the element available — avoids
 * the "map un-fogged for one frame" flicker.
 */
export function useFogDisplayCanvas(bodyId: string | undefined): {
  canvas: HTMLCanvasElement | null;
  version: number;
  width: number;
  height: number;
} {
  const { mask, version } = useBodyFogMask(bodyId);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);

  // `mask` reference is stable across mutations; `version` bumps to signal
  // that mask.data bytes have changed and the canvas needs repainting.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version triggers repaint when mask bytes change
  useEffect(() => {
    if (!mask) return;
    if (typeof document === "undefined") return;
    let c = canvas;
    if (c?.width !== mask.width || c?.height !== mask.height) {
      c = document.createElement("canvas");
      c.width = mask.width;
      c.height = mask.height;
      imageDataRef.current = null;
      setCanvas(c);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let img = imageDataRef.current;
    if (img?.width !== mask.width || img?.height !== mask.height) {
      img = ctx.createImageData(mask.width, mask.height);
      imageDataRef.current = img;
    }
    const pixels = img.data;
    const source = mask.data;
    // RGBA = (0, 0, 0, 255 - alpha): dark where un-imaged, transparent where
    // fully imaged. Leaves a gradient over partially-imaged areas so the
    // edge of a pass is visible.
    for (let i = 0, p = 0; i < source.length; i++, p += 4) {
      pixels[p] = 0;
      pixels[p + 1] = 0;
      pixels[p + 2] = 0;
      pixels[p + 3] = 255 - source[i];
    }
    ctx.putImageData(img, 0, 0);
  }, [mask, version, canvas]);

  return {
    canvas,
    version,
    width: mask?.width ?? DEFAULT_MASK_WIDTH,
    height: mask?.height ?? DEFAULT_MASK_HEIGHT,
  };
}
