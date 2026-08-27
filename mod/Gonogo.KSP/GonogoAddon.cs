using System;
using System.IO;
using Sitrep.Host;
using Sitrep.Host.Crew;
using Sitrep.Host.Economy;
using Sitrep.Host.Maneuver;
using Sitrep.Host.ActionGroups;
using Sitrep.Host.Propagation;
using UnityEngine;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// The mod's entry point. <c>KSPAddon.Startup.Instantly</c> +
    /// <c>once: true</c> loads this exactly once, at the earliest possible
    /// point (before the main menu), and it survives every subsequent scene
    /// change via <see cref="DontDestroyOnLoad"/> - so the WS server and the
    /// recorder run continuously across main-menu -&gt; load save -&gt;
    /// flight -&gt; scene-flips -&gt; quickload -&gt; quit, exactly the
    /// session RUN.md asks the user to capture.
    ///
    /// Threading: KSP is touched ONLY from here and from
    /// <see cref="KspHost"/>'s GameEvents callbacks - both main-thread. Once
    /// <see cref="FixedUpdate"/> samples the game, it hands the raw
    /// <see cref="KspSnapshot"/> straight to <see cref="ChannelEngine.Tick"/>,
    /// which only touches primitives/registered mapper delegates and an
    /// explicit job queue on ITS side too - the per-channel mapping/Courier/
    /// serialization/socket work all happens off the main thread, per
    /// <see cref="ChannelEngine"/>'s doc comment.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Instantly, once: true)]
    public sealed class GonogoAddon : MonoBehaviour
    {
        // TODO(config): hard-coded for this first build - a future settings
        // surface (in-game GUI or a PluginData config file) should let the
        // user change bind host/port without a rebuild.
        // Binds all interfaces (0.0.0.0) so a client on another LAN device can
        // reach it at ws://<this-machine-LAN-IP>:8090. ws:// only - read-only
        // telemetry, home-LAN scope.
        private const string BindUri = "ws://0.0.0.0:8090";

        // UT-cadence sampling: sampling the host on every physics tick is,
        // under time-warp, far more often than any consumer needs.
        // FixedUpdate below checks NowUt() cheaply every
        // tick but only calls the (comparatively expensive) Sample() once
        // this many UT seconds have elapsed since the last sample - warp
        // safe because it's gated on game time, not wall-clock/tick count.
        private const double SampleIntervalUt = 1.0;

        // Periodic recording flush. Writing only at quit means a serialization
        // bug surfaces only at quit, by which point the whole session is lost.
        // Flushing every ~60s of REAL (wall-clock) time - not UT - means the
        // file exists and grows almost immediately, a bad serialize throws on
        // the FIRST flush (visible in KSP.log within a minute, not at quit),
        // and a crash mid-session only loses the last partial interval instead
        // of the whole flight. Wall-clock,
        // gated via FlushCadence, is deliberately steady under time-warp -
        // unlike SampleIntervalUt above, this must NOT speed up/slow down
        // with warp.
        private const double FlushIntervalSeconds = 60.0;

        /// <summary>
        /// M3 R3's shared id registry, hoisted to a mod-wide static so the
        /// discovery-required parameterless <c>VesselUplink()</c> constructor
        /// (see its own doc comment) can build a <see cref="KspVesselActuator"/>
        /// against the SAME instance <see cref="KspHost"/> stamps
        /// <c>vessel.maneuver</c> node ids from, without <see cref="UplinkDiscovery"/>
        /// needing any KSP-specific constructor-argument-resolution mechanism.
        /// Set once, here, before discovery runs; never reassigned afterward.
        /// </summary>
        internal static ReferenceIdRegistry<ManeuverNode> SharedManeuverNodeIdRegistry { get; } = new ReferenceIdRegistry<ManeuverNode>();

        private KspHost? _host;
        private Recorder? _recorder;
        // Dev-capture recorder gate. OFF by default: the recorder writes a
        // growing session-*.json every flush and spams the log heartbeat, which
        // is pure overhead for a normal launch, it's only wanted when actively
        // capturing a reference fixture. Opt in via PluginData/gonogo.cfg's
        // RECORDING node (`enabled = true`). The recorder object is still
        // CONSTRUCTED unconditionally (the FixedUpdate sample/Tick path that
        // drives the live stream is guarded on `_recorder != null`); this flag
        // gates only the Record + flush calls, never the live emit.
        private bool _recordingEnabled;
        private ChannelEngine? _engine;
        private bool _shutDown;
        private double? _lastSampledUt;
        private string? _sessionPath;
        private float _lastFlushRealtime;

        private void Awake()
        {
            DontDestroyOnLoad(gameObject);

            try
            {
                _host = new KspHost(SharedManeuverNodeIdRegistry);
                _recorder = new Recorder(_host);
                // executeCommandsOnMainThread: true. The engine marshals every
                // command handler onto its main-thread queue, drained by
                // _engine.RunPendingCommands() in FixedUpdate below, so live
                // KSP/Unity actuation (KspVesselActuator) runs on the Unity
                // main thread, never the Courier thread: touching a KSP/Unity
                // API from Courier is the crash class KspVesselActuator's doc
                // comment describes.
                _engine = new ChannelEngine(BindUri, executeCommandsOnMainThread: true);

                // Route the engine's fail-soft diagnostics to the KSP log.
                // Sitrep.Host otherwise logs only to Console.Error, which KSP does
                // NOT capture: so a disabled/unavailable uplink or a retrying
                // capture-throw was invisible in the live log. That invisibility
                // hid the SCANsat coverage root cause for the entire
                // investigation; this sink makes the whole fail-soft class
                // visible at [WRN] level.
                _engine.SetDiagnosticLog(msg => Debug.LogWarning("[Gonogo] " + msg));

                // [SitrepUplink] assembly-scan discovery REPLACES the
                // previous hardcoded RegisterUplink(new XyzUplink()) list:
                // see Sitrep.Host.UplinkDiscovery's doc comment. The bundled
                // core uplinks (System/Vessel/Career/Science/Parts) carry
                // the attribute identically to any future third-party
                // Uplink: nothing about this loop is special-cased to them.
                // Two-pass registration (RegisterDiscoveredUplinks): every
                // capability is declared BEFORE any provider registers, so the
                // comms election is correct regardless of the order the
                // assembly scan happens to return uplinks in; see
                // ChannelEngine.RegisterDiscoveredUplinks / the two-pass fix.
                // Enable the light-time delay capability BEFORE discovery, so
                // the comms uplink's SignalDelay source is configured at
                // Register time. This wiring was previously MISSING,
                // ConfigureSignalDelay had no caller, so SignalDelayConfig
                // stayed at its Off() default and comms.delay was always 0
                // (the headline delay feature was dormant). Config comes from
                // PluginData/gonogo.cfg (a SIGNAL_DELAY node with `enabled` +
                // `lightSpeedScale`) so delay can be tuned without a rebuild;
                // absent config = ON at real light-speed (scale 1.0).
                CommsCoreUplink.ConfigureSignalDelay(ReadSignalDelayConfig());
                _recordingEnabled = ReadRecordingEnabled();
                // The fleet.<guid>.* namespace: core vessel-network-presence
                // facts, unconditional and independent of whether any comms
                // backend is ever elected (see FleetChannels's own doc
                // comment). Registered directly, not via [SitrepUplink]
                // discovery: it is a scope, not a separately-installable
                // capability, the same reasoning CommandCentreDelayUplink
                // below is registered directly for.
                _engine.RegisterUplink(new FleetChannels());
                _engine.RegisterDiscoveredUplinks(UplinkDiscovery.Discover());

                // Plan 3 command centres (agent-6): the stock home-node + crewed-
                // vessel sources feed BOTH set-vantage validation (the engine's own
                // registry) AND the per-(authority, subject) delay pass + roster
                // (the uplink's registry). The sources are stateless enumerators, so
                // both registries enumerate identically. Registered after discovery,
                // before ResolveCapabilities: the delay uplink declares one channel
                // (commandCentre.roster) and no capability provider. VERIFY at fold.
                var ccSources = new Sitrep.Contract.ICommandCentreSource[]
                {
                    new CommandCentres.StockHomeNodeSource(),
                    new CommandCentres.CrewedVesselSource(),
                };
                var ccRegistry = new Sitrep.Host.CommandCentres.CommandCentreRegistry();
                foreach (var src in ccSources)
                {
                    _engine.RegisterCommandCentreSource(src);
                    ccRegistry.RegisterSource(src);
                }
                _engine.RegisterUplink(new CommandCentres.CommandCentreDelayUplink(ccRegistry));
                // comms.commandCentre: give
                // CommsCoreUplink the SAME registry instance so it resolves the
                // active vessel's terminal node against the live centres the
                // roster above already enumerates, instead of re-scanning its
                // own throwaway sources every comms capture tick.
                CommsCoreUplink.ConfigureCommandCentreRegistry(ccRegistry);
                // Drive the capability Kernel once every uplink has registered
                // its providers (the comms backend election, CommNet vanilla vs
                // RealAntennas when present, see Sitrep.Host.Comms.CommsElection)
                // and BEFORE Start(), so the shared comms.* channel closures that
                // Query the elected backend at Tick time see a resolved kernel.
                _engine.ResolveCapabilities();
                LogDerivedCurrencyArms();

                // Install the READ-side elected-action-groups-backend resolver
                // now the Kernel has resolved (VesselUplink declared the
                // capability in the pre-Register pass and installed the
                // WRITE-side resolver on its actuator). KspHost samples the
                // backend on the main thread inside BuildControl, the same
                // main-thread seam the comms uplink reads ICommsBackend from.
                // Late-bound because the engine, and therefore the Kernel, does
                // not exist when KspHost is constructed above.
                var engine = _engine;
                _host.SetActionGroupsBackendSource(
                    () => ActionGroupsElection.Elected(engine.Kernel));

                // Same late-bound install for the maneuver plan: whatever wins
                // the election answers vessel.maneuver, and the capture never
                // touches patchedConicSolver itself.
                _host.SetManeuverPlanSource(
                    () => ManeuverPlanElection.Elected(engine.Kernel));

                // Same late-bound install for the propagation provider (the
                // Kepler vanilla, or an n-body provider when elected) -- KspHost
                // samples it on the main thread and stamps vessel.target's
                // closestApproach. One election answers both the trajectory and the
                // encounter on it, which is what stops the two disagreeing.
                _host.SetPropagationSource(
                    () => PropagationElection.Elected(engine.Kernel));

                // Same late-bound install for the economy interpretation: whatever
                // money model won the election says what this career's reputation
                // MEANS, and KspHost hands it the reputation it already read
                // rather than the backend reading it, so there is one place that
                // number comes from. Read on the main thread inside
                // BuildCareerEconomy, because an overhaul's figures come off its
                // own live scenario modules.
                _host.SetEconomyBackendSource(
                    () => EconomyElection.Elected(engine.Kernel));

                // Same late-bound install for the crew standing: whatever crew
                // model won the election decides whether a kerbal off the flight
                // roster is dead or retired, and the capture stamps that answer
                // onto the roster entries rather than deriving it from KSP's
                // roster status, which a career overhaul overwrites.
                _host.SetCrewStandingBackendSource(
                    () => CrewStandingElection.Elected(engine.Kernel));

                // The planning half of the same physics. The election above answers
                // where a craft goes from where the game says it IS; this answers
                // where it goes from where a vantage was TOLD it was, and at
                // light-time those are different states and so different curves.
                // Sharing the integrator is what later makes the two comparable.
                //
                // Assembled here rather than registered as a provider, for the same
                // reason as the arc source in VesselUplink: it composes two
                // elections with a body table only this assembly can read, and none
                // of the three is entitled to know about the other two.
                //
                // The force model ignores the body index it is handed because the
                // elected source publishes one model for the whole system. The index
                // chooses the perturber neighbourhood, not the physics.
                _engine.SeededPropagation = new SeededNBodyProvider(
                    GravitationalParameterOf,
                    KspPerturbers.Around,
                    () => PropagationElection.Elected(engine.Kernel),
                    _ => GravityModelElection.Model(engine.Kernel));

                // The command gates' evaluators, each wrapping one authority KSP
                // publishes (game mode, loaded scene, the GameVariables facility
                // surface, ClearToSaveStatus, the PreFlightTests set). Registered
                // HERE rather than inside an Uplink because none of them belongs
                // to a domain: career and flight-ops both declare requirements
                // that these answer, and a kind may only be claimed once. Before
                // Start(), which is where ValidateGateDeclarations checks that
                // every declared kind has one: a gate nobody can evaluate is a
                // gate that silently does not exist.
                foreach (var evaluator in Gates.KspGateEvaluators.All())
                {
                    _engine.AddGateEvaluator(evaluator);
                }

                _engine.Start();

                // Session file path is established ONCE here, at startup, and
                // reused for every periodic flush AND the final save. Computed
                // fresh at quit instead, a crash would leave no file at all.
                // Directory creation belongs here for the same reason.
                var dir = Path.Combine(KSPUtil.ApplicationRootPath, "GameData", "Gonogo", "PluginData", "recordings");
                Directory.CreateDirectory(dir);
                _sessionPath = Path.Combine(dir, "session-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + ".json");
                _lastFlushRealtime = Time.realtimeSinceStartup;

                Debug.Log("[Gonogo] Started - serving " + SystemViewProvider.Topic + " + " +
                    VesselViewProvider.Topics.Count + " vessel.* channels on " + BindUri);
                LogBuildIdentity();
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] Failed to start: " + ex);
            }
        }

        /// <summary>
        /// Reads the light-time delay config from
        /// <c>GameData/Gonogo/PluginData/gonogo.cfg</c> (a <c>SIGNAL_DELAY</c>
        /// node: <c>enabled = true|false</c>, <c>lightSpeedScale = &lt;double&gt;</c>).
        /// Default when the file/node is absent: delay ON at real light-speed
        /// (scale 1.0): the mod's realism default. A smaller scale lengthens
        /// delay (slower light); a larger scale shortens it. Never throws.
        /// </summary>
        /// <summary>
        /// Which binary is actually running, logged at startup.
        ///
        /// <para>Verifying a live fix means knowing the game loaded the DLL you
        /// just built, and that is not safe to assume: a stale RealAntennas
        /// uplink silently broke the whole comms capability for hours, and file
        /// SIZE is no identity check - two different builds collided on the same
        /// byte count twice in one day. The MVID is a fresh GUID per
        /// compilation, so two builds cannot agree by accident.</para>
        ///
        /// <para>Cheap insurance against the most expensive kind of wasted
        /// cycle: a conclusion drawn from a binary that was never deployed.</para>
        /// </summary>
        /// <summary>
        /// A body's gravitational parameter by its <c>FlightGlobals.Bodies</c> index,
        /// which is the index every other body table in this mod speaks, or null when
        /// the game has no body there.
        ///
        /// <para>Reached from the Courier thread as well as the main one, so it touches
        /// a plain managed field and nothing native: a native accessor here would throw
        /// inside the solve and come back as a refusal, which reads as "this state
        /// cannot be integrated" rather than as the fault it is.</para>
        /// </summary>
        private static double? GravitationalParameterOf(int bodyIndex)
        {
            var bodies = FlightGlobals.Bodies;
            if (bodies == null || bodyIndex < 0 || bodyIndex >= bodies.Count)
            {
                return null;
            }

            var body = bodies[bodyIndex];
            return body != null ? (double?)body.gravParameter : null;
        }

        private static void LogBuildIdentity()
        {
            try
            {
                var assembly = typeof(GonogoAddon).Assembly;
                var built = File.Exists(assembly.Location)
                    ? File.GetLastWriteTimeUtc(assembly.Location).ToString("yyyy-MM-dd HH:mm:ss") + "Z"
                    : "unknown";
                Debug.Log("[Gonogo] build: mvid=" + assembly.ManifestModule.ModuleVersionId
                    + " written=" + built);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] could not read build identity: " + ex.Message);
            }
        }

        /// <summary>
        /// Names, in <c>KSP.log</c>, which mods have an arm keeping a quantity they
        /// DERIVE from a currency change withheld for as long as the change is.
        ///
        /// <para>Here because this is the only place that can say it: an arm lives in
        /// its own Uplink assembly, which references no game assembly and so has no
        /// log to write to, and the outcome was previously carried only as a health
        /// fact on <c>system.uplinks</c>. A rig operator cannot read that, so
        /// "registered" and "never registered" were the same silence, and a rig run
        /// with the leak still wide open could not be told from a deployment
        /// problem.</para>
        ///
        /// <para>After <c>ResolveCapabilities</c> and not before: a provider is
        /// registered during an uplink's <c>Register</c> and only becomes active when
        /// the kernel resolves, so asked any earlier this would truthfully report
        /// nothing on a perfectly working install.</para>
        /// </summary>
        private static void LogDerivedCurrencyArms()
        {
            try
            {
                var arms = CurrencyDelay.DerivedCurrencyWithholding.ActiveArmIds();
                Debug.Log("[Gonogo] derived-currency arms: "
                    + (arms.Count == 0
                        ? "none. No installed mod registered one, or its Uplink refused to; nothing "
                          + "derived from a delayed currency change will be withheld"
                        : string.Join(", ", arms)));
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] could not read the derived-currency arms: " + ex.Message);
            }
        }

        private static Sitrep.Host.Comms.SignalDelayConfig ReadSignalDelayConfig()
        {
            var cfg = new Sitrep.Host.Comms.SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };
            try
            {
                var path = Path.Combine(KSPUtil.ApplicationRootPath, "GameData", "Gonogo", "PluginData", "gonogo.cfg");
                if (File.Exists(path))
                {
                    var root = ConfigNode.Load(path);
                    var node = root?.GetNode("SIGNAL_DELAY");
                    if (node != null)
                    {
                        if (node.HasValue("enabled") && bool.TryParse(node.GetValue("enabled"), out var en))
                        {
                            cfg.Enabled = en;
                        }
                        if (node.HasValue("lightSpeedScale") && double.TryParse(node.GetValue("lightSpeedScale"), out var scale) && scale > 0.0)
                        {
                            cfg.LightSpeedScale = scale;
                        }
                        // Absent means OFF: a simulation cuts the delay unless
                        // the operator asked to rehearse under it. Written back
                        // here by the console's own command, see
                        // GonogoConfigFile.
                        if (node.HasValue("delayInSimulation") && bool.TryParse(node.GetValue("delayInSimulation"), out var inSim))
                        {
                            cfg.DelayInSimulation = inSim;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] signal-delay config read failed, using defaults: " + ex.Message);
            }

            Debug.Log("[Gonogo] SignalDelay enabled=" + cfg.Enabled
                + " lightSpeedScale=" + cfg.LightSpeedScale
                + " delayInSimulation=" + cfg.DelayInSimulation);
            return cfg;
        }

        /// <summary>
        /// Reads the dev-capture recorder toggle from
        /// <c>GameData/Gonogo/PluginData/gonogo.cfg</c> (a <c>RECORDING</c> node:
        /// <c>enabled = true|false</c>). Defaults to <b>false</b> (off), unlike
        /// <see cref="ReadSignalDelayConfig"/>, absent config means OFF, because
        /// recording is a dev fixture-capture tool that only wastes disk + log
        /// on a normal launch. Opt in only when actively capturing a fixture.
        /// </summary>
        private static bool ReadRecordingEnabled()
        {
            var enabled = false;
            try
            {
                var path = Path.Combine(KSPUtil.ApplicationRootPath, "GameData", "Gonogo", "PluginData", "gonogo.cfg");
                if (File.Exists(path))
                {
                    var root = ConfigNode.Load(path);
                    var node = root?.GetNode("RECORDING");
                    if (node != null && node.HasValue("enabled") && bool.TryParse(node.GetValue("enabled"), out var en))
                    {
                        enabled = en;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] recording config read failed, defaulting off: " + ex.Message);
            }

            Debug.Log("[Gonogo] Recording enabled=" + enabled);
            return enabled;
        }

        /// <summary>
        /// F2-fix (CRITICAL): the command-queue drain runs from Update(), NOT
        /// FixedUpdate(). KSP pause (<c>Time.timeScale = 0</c>, the Esc menu /
        /// <c>FlightDriver.SetPause</c>) STOPS FixedUpdate but Update() keeps
        /// running every frame regardless of timeScale: so an instant command
        /// dispatched while paused (time.warp / time.pause / vessel.target, and
        /// critically the UNPAUSE command itself) now executes on the main
        /// thread instead of parking the single-drain Courier thread on
        /// <c>Done.Wait()</c> until the player unpauses in-game (which, for the
        /// unpause command, could never happen, a self-wedge). These are the
        /// same actuator calls FixedUpdate would have made; KSP applies or
        /// queues them fine off Update. Telemetry sampling stays in FixedUpdate
        /// (physics cadence): only the command drain moved here.
        /// </summary>
        private void Update()
        {
            // Drain any command handler marshaled onto the engine's main-thread
            // queue (see ChannelEngine.RunPendingCommands). The Courier thread
            // blocks (bounded) waiting on exactly this drain. Never throws.
            _engine?.RunPendingCommands();
            // Re-read every gated command's requirements and publish them to
            // system.uplink.gates, so a control can be drawn dark before it is
            // pressed. HERE rather than in a channel mapper because a gate
            // evaluator reads live KSP state and mappers run on the Courier
            // thread; see ChannelEngine.SampleCommandGates. Self-throttling
            // (GateSampleIntervalSec), so calling it per frame is not a per-frame
            // cost, and never throws.
            //
            // Update() rather than FixedUpdate() for the same reason the command
            // drain is here: FixedUpdate stops while the game is paused, and a
            // paused game is exactly when an operator has time to read which
            // controls are live.
            _engine?.SampleCommandGates();
        }

        private void FixedUpdate()
        {
            if (_host == null || _recorder == null || _engine == null)
            {
                return;
            }

            // Only capture in a loaded GAME scene (FLIGHT/SPACECENTER/EDITOR/
            // TRACKSTATION). At MAINMENU (and LOADING/SETTINGS/CREDITS) there is
            // no game to sample: `Sample()` would walk uninitialised KSP/Unity
            // state, and a producer that doesn't guard the no-vessel/no-game case
            // can hang the main thread there (an infinite loop, which Sample()'s
            // catch-and-degrade discipline can't rescue). That hang starves every
            // other MAINMENU coroutine: notably GonogoDevAutoLoad's save load.
            // The WS server (background thread) stays up regardless; a client that
            // connects at the menu simply sees no telemetry, which is correct.
            if (!HighLogic.LoadedSceneIsGame)
            {
                return;
            }

            // Periodic flush check, independent of the sampling cadence
            // below: FlushRecording catches its own exceptions and logs
            // them, so a bad flush can never crash this callback or stop
            // sampling - the next flush 60s later simply retries.
            var nowRealtime = Time.realtimeSinceStartup;
            if (FlushCadence.ShouldFlush(nowRealtime - _lastFlushRealtime, FlushIntervalSeconds))
            {
                _lastFlushRealtime = nowRealtime;
                FlushRecording();
            }

            try
            {
                // NowUt() is cheap (wraps Planetarium.GetUniversalTime()) so
                // it's fine to call every physics tick just to check the
                // cadence gate; Sample() is the comparatively expensive call
                // (walks live KSP/Unity state), so it's only made once this
                // much UT has actually elapsed since the last sample - warp
                // safe, since it's driven by game time, not tick count.
                //
                // SampleCadence.ShouldSample also forces an immediate
                // resample on a BACKWARD UT jump (F9 quickload): a
                // forward-only `<` comparison goes strongly negative and
                // never trips, stalling the recorder AND the live stream
                // (GonogoBodiesServer's rewind-detection can't fire because
                // Tick is never reached) across exactly the event most worth
                // capturing. See SampleCadence's doc comment.
                var ut = _host.NowUt();
                if (!SampleCadence.ShouldSample(ut, _lastSampledUt, SampleIntervalUt))
                {
                    return;
                }
                _lastSampledUt = ut;

                // ONE Sample() call per cadence tick feeds BOTH the recorder
                // and the system.bodies emit path below - the v1 mod sampled
                // the host twice (once for the recorder, once here) and
                // called NowUt() a third time; that redundancy is gone.
                var snapshot = _host.Sample();

                // The recorder is a dev-capture tool: it records this
                // snapshot UNCONDITIONALLY, regardless of whether any client
                // is subscribed to the live stream. Subscription-gating
                // applies only to the emit path below (inside
                // ChannelEngine.Tick, via SubscriptionRegistry + ChannelEmitter,
                // per registered channel) - never to the recorder.
                if (_recordingEnabled)
                {
                    _recorder.Record(snapshot.Ut, snapshot);
                }

                // The engine applies every registered channel's mapper
                // (system.bodies's is SystemViewProvider.BuildSystemBodies,
                // via SystemUplink) itself, rather than GonogoAddon building
                // the payload by hand.
                _engine.Tick(snapshot.Ut, snapshot);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] FixedUpdate sampling failed: " + ex);
            }
        }

        private void OnDestroy() => Shutdown();

        private void OnApplicationQuit() => Shutdown();

        private void Shutdown()
        {
            if (_shutDown)
            {
                return;
            }
            _shutDown = true;

            try
            {
                _engine?.Stop();
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] Error stopping server: " + ex);
            }

            // The final save is just the LAST flush, to the same fixed path
            // every periodic flush already used.
            FlushRecording();

            try
            {
                _host?.Unhook();
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] Error unhooking GameEvents: " + ex);
            }
        }

        /// <summary>
        /// Re-writes the current session to <see cref="_sessionPath"/> in
        /// full (sessions are small, so a full re-write per flush is fine -
        /// incremental append is a future optimization if sessions grow
        /// large) and logs the result. This is the in-game confirmation a
        /// user checks <c>KSP.log</c> for: on success, growing counts +
        /// file size prove recording is alive; on failure, the exception is
        /// logged immediately (within one flush interval, not at quit) but
        /// swallowed here so a bad flush never crashes the addon or halts
        /// sampling - the next periodic flush simply retries.
        /// </summary>
        private void FlushRecording()
        {
            if (!_recordingEnabled || _recorder == null || _sessionPath == null)
            {
                return;
            }

            try
            {
                _recorder.Save(_sessionPath);
                var sizeKb = new FileInfo(_sessionPath).Length / 1024.0;
                Debug.Log(string.Format(
                    "[Gonogo] recording: {0} snapshots, {1} events → {2} ({3:F1} KB)",
                    _recorder.SnapshotCount,
                    _recorder.EventCount,
                    Path.GetFileName(_sessionPath),
                    sizeKb));
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] recording FLUSH FAILED: " + ex);
            }
        }
    }
}
