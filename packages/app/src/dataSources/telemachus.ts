import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/core";
import { PerfBudget, registerDataSource } from "@ksp-gonogo/core";
import { LocalStorageStore } from "@ksp-gonogo/data";
import { logger } from "@ksp-gonogo/logger";

// TelemaachusSchema lives in @ksp-gonogo/core and is pre-registered in DataSourceRegistry.
// Re-export it here so callers that import from this module path keep working.
export type { TelemaachusSchema } from "@ksp-gonogo/core";

// All static (non-indexed) keys from TelemaachusSchema, used to populate
// schema() so PeerBroadcastingDataSource can subscribe to everything upfront.
const TELEMACHUS_KEYS: DataKey[] = [
  // Position & altitude
  { key: "v.altitude" },
  { key: "v.heightFromTerrain" },
  { key: "v.heightFromSurface" },
  { key: "v.terrainHeight" },
  { key: "v.lat" },
  { key: "v.long" },
  // Velocity. `v.obtSpeed` is intentionally omitted — it reads KSP's stock
  // `Vessel.obt_speed` which is known-flaky (often stuck at 0). Use
  // `v.orbitalVelocity` instead; it reads `obt_velocity.magnitude` reliably.
  { key: "v.surfaceSpeed" },
  { key: "v.verticalSpeed" },
  { key: "v.orbitalVelocity" },
  { key: "v.surfaceVelocity" },
  { key: "v.speed" },
  { key: "v.srfSpeed" },
  // Forces & environment
  { key: "v.geeForce" },
  { key: "v.geeForceImmediate" },
  { key: "v.mass" },
  { key: "v.mach" },
  { key: "v.dynamicPressure" },
  { key: "v.dynamicPressurekPa" },
  { key: "v.staticPressure" },
  { key: "v.atmosphericPressure" },
  // Situation & state
  { key: "v.name" },
  { key: "v.body" },
  { key: "v.situation" },
  { key: "v.situationString" },
  { key: "v.missionTime" },
  { key: "v.missionTimeString" },
  { key: "v.currentStage" },
  { key: "v.landed" },
  { key: "v.splashed" },
  { key: "v.landedAt" },
  { key: "v.isEVA" },
  { key: "v.crew" },
  { key: "v.crewCount" },
  { key: "v.crewCapacity" },
  { key: "v.angleToPrograde" },
  // Action group state
  { key: "v.sasValue" },
  { key: "v.rcsValue" },
  { key: "v.lightValue" },
  { key: "v.brakeValue" },
  { key: "v.gearValue" },
  { key: "v.abortValue" },
  { key: "v.precisionControlValue" },
  { key: "v.ag1Value" },
  { key: "v.ag2Value" },
  { key: "v.ag3Value" },
  { key: "v.ag4Value" },
  { key: "v.ag5Value" },
  { key: "v.ag6Value" },
  { key: "v.ag7Value" },
  { key: "v.ag8Value" },
  { key: "v.ag9Value" },
  { key: "v.ag10Value" },
  // Navigation
  { key: "n.heading" },
  { key: "n.pitch" },
  { key: "n.roll" },
  { key: "n.rawheading" },
  { key: "n.rawpitch" },
  { key: "n.rawroll" },
  { key: "n.heading2" },
  { key: "n.pitch2" },
  { key: "n.roll2" },
  // Flight control
  { key: "f.throttle" },
  // Orbit — apsides
  { key: "o.ApA" },
  { key: "o.PeA" },
  { key: "o.ApR" },
  { key: "o.PeR" },
  { key: "o.timeToAp" },
  { key: "o.timeToPe" },
  // Celestial bodies (static count key only; indexed b.name[n] etc. are runtime)
  { key: "b.number" },
  // Keplerian elements
  { key: "o.sma" },
  { key: "o.semiMinorAxis" },
  { key: "o.semiLatusRectum" },
  { key: "o.eccentricity" },
  { key: "o.inclination" },
  { key: "o.lan" },
  { key: "o.argumentOfPeriapsis" },
  { key: "o.period" },
  { key: "o.epoch" },
  { key: "o.referenceBody" },
  // Anomalies
  { key: "o.trueAnomaly" },
  { key: "o.meanAnomaly" },
  { key: "o.eccentricAnomaly" },
  { key: "o.orbitPercent" },
  // Velocity & energy
  { key: "o.orbitalSpeed" },
  { key: "o.radius" },
  { key: "o.orbitalEnergy" },
  // Patch transitions
  { key: "o.timeToTransition1" },
  { key: "o.timeToTransition2" },
  // Time
  { key: "t.universalTime" },
  { key: "t.currentRate" },
  // Warp index ("0..7" for HIGH, similar for LOW). Telemachus Reborn
  // publishes this as `t.timeWarp`; the alarm host uses it to decide
  // whether warp is elevated. Without it, only `t.currentRate` updates,
  // and the banner can't tell index=0 from "no telemetry".
  { key: "t.timeWarp" },
  { key: "t.warpMode" },
  { key: "t.isPaused" },
  // Resources (vessel-wide + current-stage, for the fuel widget)
  { key: "r.resource[LiquidFuel]" },
  { key: "r.resourceMax[LiquidFuel]" },
  { key: "r.resourceCurrent[LiquidFuel]" },
  { key: "r.resourceCurrentMax[LiquidFuel]" },
  { key: "r.resource[Oxidizer]" },
  { key: "r.resourceMax[Oxidizer]" },
  { key: "r.resourceCurrent[Oxidizer]" },
  { key: "r.resourceCurrentMax[Oxidizer]" },
  { key: "r.resource[MonoPropellant]" },
  { key: "r.resourceMax[MonoPropellant]" },
  { key: "r.resourceCurrent[MonoPropellant]" },
  { key: "r.resourceCurrentMax[MonoPropellant]" },
  { key: "r.resource[XenonGas]" },
  { key: "r.resourceMax[XenonGas]" },
  { key: "r.resourceCurrent[XenonGas]" },
  { key: "r.resourceCurrentMax[XenonGas]" },
  { key: "r.resource[ElectricCharge]" },
  { key: "r.resourceMax[ElectricCharge]" },
  { key: "r.resourceCurrent[ElectricCharge]" },
  { key: "r.resourceCurrentMax[ElectricCharge]" },
  { key: "r.resource[SolidFuel]" },
  { key: "r.resourceMax[SolidFuel]" },
  { key: "r.resourceCurrent[SolidFuel]" },
  { key: "r.resourceCurrentMax[SolidFuel]" },
  // Stage info — `dv.stages` is the whole-vessel complex object, so one
  // subscription covers all stages regardless of count. Consumers project
  // the field they want (fuelMass, deltaVVac, etc.) client-side.
  { key: "dv.stageCount" },
  { key: "dv.stages" },
  { key: "dv.totalDVVac" },
  { key: "dv.totalDVASL" },
  { key: "dv.totalDVActual" },
  { key: "dv.totalBurnTime" },
  // Trajectory prediction: full patch list + maneuver nodes (complex objects),
  // physics-mode flag for Principia detection, landing prediction.
  { key: "o.orbitPatches" },
  { key: "o.maneuverNodes" },
  { key: "a.physicsMode" },
  { key: "land.timeToImpact" },
  { key: "land.speedAtImpact" },
  { key: "land.bestSpeedAtImpact" },
  { key: "land.suicideBurnCountdown" },
  { key: "land.predictedLat" },
  { key: "land.predictedLon" },
  { key: "land.predictedAlt" },
  { key: "land.slopeAngle" },
  // Thermal — aggregate "hottest of" readouts.
  { key: "therm.hottestPartTemp" },
  { key: "therm.hottestPartTempKelvin" },
  { key: "therm.hottestPartMaxTemp" },
  { key: "therm.hottestPartTempRatio" },
  { key: "therm.hottestPartName" },
  { key: "therm.hottestEngineTemp" },
  { key: "therm.hottestEngineMaxTemp" },
  { key: "therm.hottestEngineTempRatio" },
  { key: "therm.anyEnginesOverheating" },
  { key: "therm.heatShieldTemp" },
  { key: "therm.heatShieldTempCelsius" },
  { key: "therm.heatShieldFlux" },
  // CommNet — vanilla KSP mission-control link. NOT the Telemachus
  // antenna link; comm.connected reports green even when the Telemachus
  // antenna is missing/powered-down (verified live 2026-05-18). Useful
  // for showing mission-control connectivity but DO NOT use it as the
  // telemetry trust gate — that's `p.paused` (see below).
  { key: "comm.connected" },
  { key: "comm.signalStrength" },
  { key: "comm.controlState" },
  { key: "comm.controlStateName" },
  { key: "comm.signalDelay" },
  // Telemachus antenna status. The canonical trust gate: BufferedData-
  // Source drops vessel-required samples when p.paused !== 0 (and !== 1
  // for the legitimate game-pause case). When the Telemachus antenna is
  // missing / unpowered / toggled off, many vessel-required keys collapse
  // to the literal value 2 — verified live 2026-05-18.
  // Codes: 0 = active, 1 = game paused, 2 = no power (or fork-bug
  // collapse of 3/4), 3 = off, 4 = not found, 5 = not in flight.
  { key: "p.paused" },
  // Target
  { key: "tar.name" },
  { key: "tar.type" },
  { key: "tar.distance" },
  { key: "tar.o.PeA" },
  { key: "tar.o.ApA" },
  { key: "tar.o.sma" },
  { key: "tar.o.inclination" },
  { key: "tar.o.eccentricity" },
  { key: "tar.o.period" },
  { key: "tar.o.relativeVelocity" },
  { key: "tar.o.orbitingBody" },
  { key: "tar.o.lan" },
  { key: "tar.o.argumentOfPeriapsis" },
  { key: "tar.o.trueAnomaly" },
  { key: "tar.o.timeToPe" },
  { key: "tar.o.timeToAp" },
  // Docking alignment — angles + in-plane distances. Stock KSP; valid
  // when the vessel is oriented for a docking approach.
  { key: "dock.ax" },
  { key: "dock.ay" },
  { key: "dock.az" },
  { key: "dock.x" },
  { key: "dock.y" },
];

// ---------------------------------------------------------------------------

export interface TelemachusConfig extends Record<string, unknown> {
  host: string;
  port: number;
}

const DEFAULT_CONFIG: TelemachusConfig = { host: "localhost", port: 8085 };
const configStore = new LocalStorageStore<TelemachusConfig>({
  key: "gonogo.datasource.telemachus",
  defaults: DEFAULT_CONFIG,
});
const RETRY_INTERVAL_MS = 5_000;
const RETRY_TIMEOUT_MS = 5 * 60 * 1000;

interface RetryOptions {
  retryIntervalMs?: number;
  retryTimeoutMs?: number;
}

/**
 * Soft cap on samples emitted to local subscribers. Telemachus runs at 4 Hz
 * across ~170 schema keys (worst-case 680/sec when every key changes per
 * tick), plus indexed runtime keys. 2500 leaves ~3.5x headroom over the
 * realistic steady state — tight enough to flag a runaway WS rate or a
 * duplicated subscription, loose enough to absorb a normal full-tick burst.
 */
const TELEMACHUS_SAMPLE_BUDGET = new PerfBudget({
  name: "Telemachus samples emitted/sec",
  threshold: 2500,
  windowMs: 1000,
  unit: "samples",
});

export class TelemachusDataSource implements DataSource<TelemachusConfig> {
  id = "telemachus";
  name = "Telemachus Reborn";
  status: DataSourceStatus = "disconnected";
  // Telemachus data is gated by CommNet — during signal loss we drop samples
  // at the buffering layer so historical data has a clean gap. `comm.*` keys
  // are exempt (we need them to detect the signal-restore event).
  affectedBySignalLoss = true;

  private statusListeners = new Set<(status: DataSourceStatus) => void>();
  private ws: WebSocket | null = null;
  private cfg: TelemachusConfig;
  private subscriptions = new Map<string, Set<(value: unknown) => void>>();

  private intentionalDisconnect = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryStart: number | null = null;
  private readonly retryIntervalMs: number;
  private readonly retryTimeoutMs: number;

  constructor(
    config?: TelemachusConfig,
    {
      retryIntervalMs = RETRY_INTERVAL_MS,
      retryTimeoutMs = RETRY_TIMEOUT_MS,
    }: RetryOptions = {},
  ) {
    this.cfg = config ?? configStore.get();
    this.retryIntervalMs = retryIntervalMs;
    this.retryTimeoutMs = retryTimeoutMs;
  }

  // --- Connection (public) ---

  /** Explicitly connect, resetting any ongoing retry loop. */
  connect(): Promise<void> {
    this.stopRetrying();
    this.retryStart = null;
    this.intentionalDisconnect = false;
    return this.openWebSocket();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.stopRetrying();
    this.ws?.close();
    this.ws = null;
    this.setStatus("disconnected");
  }

  // --- Data ---

  schema(): DataKey[] {
    return TELEMACHUS_KEYS;
  }

  subscribe(key: string, cb: (value: unknown) => void): () => void {
    const isNewKey = !this.subscriptions.has(key);
    if (isNewKey) this.subscriptions.set(key, new Set());
    this.subscriptions.get(key)?.add(cb);

    if (isNewKey && this.ws?.readyState === WebSocket.OPEN) {
      // Include rate on the first key to establish the update interval
      const msg =
        this.subscriptions.size === 1
          ? { "+": [key], rate: 250 }
          : { "+": [key] };
      this.ws.send(JSON.stringify(msg));
    }

    return () => {
      const cbs = this.subscriptions.get(key);
      if (cbs) {
        cbs.delete(cb);
        if (cbs.size === 0) {
          this.subscriptions.delete(key);
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ "-": [key] }));
          }
        }
      }
    };
  }

  async execute(action: string): Promise<void> {
    const url = `http://${this.cfg.host}:${this.cfg.port}/telemachus/datalink?a=${encodeURIComponent(action)}`;
    // no-cors: we don't need to read the response back, so skip CORS checking.
    // The request still reaches Telemachus and state changes stream back via WS.
    //
    // Swallow transport errors (Telemachus crashed mid-request, network
    // dropped, etc.) at this boundary — every caller does `void execute(...)`
    // so a rejected promise just surfaces as an "Uncaught (in promise)" with
    // no actionable handler. The WS readback is the source of truth for
    // "did the action take effect"; if the server died, the WS reconnect
    // logic + the data source's `error` status is where the user-facing
    // signal belongs.
    try {
      await fetch(url, { mode: "no-cors" });
    } catch (err) {
      logger.tag("telemachus").warn("execute() transport failed", {
        action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  onStatusChange(cb: (status: DataSourceStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  // --- Config ---

  configSchema(): ConfigField[] {
    return [
      { key: "host", label: "Host", type: "text", placeholder: "localhost" },
      { key: "port", label: "Port", type: "number", placeholder: "8085" },
    ];
  }

  getConfig(): TelemachusConfig {
    return { host: this.cfg.host, port: this.cfg.port };
  }

  configure(config: Record<string, unknown>): void {
    this.cfg = {
      host: typeof config.host === "string" ? config.host : this.cfg.host,
      port:
        typeof config.port === "number"
          ? config.port
          : Number(config.port) || this.cfg.port,
    };
    configStore.set(this.cfg);
    this.disconnect();
    void this.connect();
  }

  /**
   * Apply a first-run seeded host WITHOUT persisting — see
   * `seedTelemachusHost`. If a connection attempt is already underway
   * against the old host, restart it against the new one.
   */
  applySeededHost(host: string): void {
    if (host === this.cfg.host) return;
    const active = this.ws !== null || this.retryTimer !== null;
    this.cfg = { ...this.cfg, host };
    if (active) {
      this.disconnect();
      void this.connect();
    }
  }

  // --- Private ---

  private openWebSocket(): Promise<void> {
    const old = this.ws;
    this.ws = null;
    old?.close();
    return new Promise((resolve, reject) => {
      const url = `ws://${this.cfg.host}:${this.cfg.port}/datalink`;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.addEventListener("open", () => {
        this.setStatus("connected");
        this.sendSubscription();
        resolve();
      });
      ws.addEventListener("message", (event) => {
        this.handleMessage(event.data as string);
      });
      ws.addEventListener("close", () => {
        if (this.ws === ws) this.onClose();
      });
      ws.addEventListener("error", () => {
        reject(new Error(`Could not connect to Telemachus Reborn at ${url}`));
      });
    });
  }

  private onClose(): void {
    if (this.intentionalDisconnect) return;
    if (this.retryStart === null) this.retryStart = Date.now();

    if (Date.now() - this.retryStart >= this.retryTimeoutMs) {
      this.retryStart = null;
      this.setStatus("disconnected"); // gave up — manual retry needed
      return;
    }

    this.setStatus("reconnecting");
    this.retryTimer = setTimeout(() => {
      void this.openWebSocket().catch(() => {
        // error event fires first and rejects; close event will call onClose() again
      });
    }, this.retryIntervalMs);
  }

  private stopRetrying(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private sendSubscription(): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.subscriptions.size > 0) {
      this.ws.send(
        JSON.stringify({ "+": [...this.subscriptions.keys()], rate: 250 }),
      );
    }
  }

  private handleMessage(raw: string): void {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, callbacks] of this.subscriptions) {
        if (key in data) {
          TELEMACHUS_SAMPLE_BUDGET.record();
          callbacks.forEach((cb) => {
            cb(data[key]);
          });
        }
      }
    } catch {
      /* ignore malformed messages */
    }
  }

  private setStatus(status: DataSourceStatus): void {
    this.status = status;
    this.statusListeners.forEach((cb) => {
      cb(status);
    });
  }
}

export const telemachusSource = new TelemachusDataSource();
registerDataSource(telemachusSource);

/**
 * First-run seeding from the bundle's `KSP_HOST` (via the relay's
 * `/bootstrap-config`). In-memory only and skipped the moment the user has
 * saved a Telemachus config — so an explicit Settings save always wins, and
 * a changed `KSP_HOST` env keeps taking effect on the next page load
 * because nothing is persisted here.
 */
export function seedTelemachusHost(host: string): void {
  if (configStore.isStored()) return;
  telemachusSource.applySeededHost(host);
}
// Note: widgets should read from the `"data"` source (the BufferedDataSource
// wrapping this one) so the CommNet signal-loss gate applies. Reading
// `"telemachus"` directly bypasses the gate — intentional as a live escape
// hatch, but it means blackout-state UI will lie for such consumers.
// Station peers see both sources via PeerBroadcastingDataSource; raw
// telemachus broadcasts are similarly un-gated.
