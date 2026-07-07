using System;
using System.IO;
using Sitrep.Host;
using UnityEngine;

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
        // reach it at ws://<this-machine-LAN-IP>:8090 (matches Telemachus's
        // LAN-wide bind). ws:// only - read-only telemetry, home-LAN scope.
        private const string BindUri = "ws://0.0.0.0:8090";

        // UT-cadence sampling (Track C): the v1 mod sampled the host every
        // physics tick, which under time-warp is far more often than any
        // consumer needs. FixedUpdate below checks NowUt() cheaply every
        // tick but only calls the (comparatively expensive) Sample() once
        // this many UT seconds have elapsed since the last sample - warp
        // safe because it's gated on game time, not wall-clock/tick count.
        private const double SampleIntervalUt = 1.0;

        // Periodic recording flush: a serialization bug used to only
        // surface at quit, after which point a bad session had already lost
        // everything. Flushing every ~60s of REAL (wall-clock) time - not UT
        // - means the file exists and grows almost immediately, a bad
        // serialize throws on the FIRST flush (visible in KSP.log within a
        // minute, not at quit), and a crash mid-session only loses the last
        // partial interval instead of the whole flight. Wall-clock,
        // gated via FlushCadence, is deliberately steady under time-warp -
        // unlike SampleIntervalUt above, this must NOT speed up/slow down
        // with warp.
        private const double FlushIntervalSeconds = 60.0;

        private KspHost? _host;
        private Recorder? _recorder;
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
                // M3 R3: ONE shared id registry for the whole session, handed
                // to both the read side (KspHost stamps vessel.maneuver node
                // ids from it) and the write side (KspVesselActuator resolves
                // update/remove's nodeId argument against it) — see
                // ReferenceIdRegistry's doc comment for why sharing this
                // single instance is what makes a node's id usable in a
                // command at all.
                var maneuverNodeIdRegistry = new ReferenceIdRegistry<ManeuverNode>();
                _host = new KspHost(maneuverNodeIdRegistry);
                _recorder = new Recorder(_host);
                _engine = new ChannelEngine(BindUri);
                _engine.RegisterExtension(new SystemExtension());
                _engine.RegisterExtension(new VesselExtension(new KspVesselActuator(maneuverNodeIdRegistry)));
                _engine.Start();

                // Session file path is established ONCE here, at startup,
                // and reused for every periodic flush AND the final save -
                // previously this was computed fresh at quit, so a crash (or
                // even a clean quit before the fix) left no file at all.
                // Directory creation moves here too, for the same reason.
                var dir = Path.Combine(KSPUtil.ApplicationRootPath, "GameData", "Gonogo", "PluginData", "recordings");
                Directory.CreateDirectory(dir);
                _sessionPath = Path.Combine(dir, "session-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + ".json");
                _lastFlushRealtime = Time.realtimeSinceStartup;

                Debug.Log("[Gonogo] Started - serving " + SystemViewProvider.Topic + " + " +
                    VesselViewProvider.Topics.Count + " vessel.* channels on " + BindUri);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] Failed to start: " + ex);
            }
        }

        private void FixedUpdate()
        {
            if (_host == null || _recorder == null || _engine == null)
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
                _recorder.Record(snapshot.Ut, snapshot);

                // The engine applies every registered channel's mapper
                // (system.bodies's is SystemViewProvider.BuildSystemBodies,
                // via SystemExtension) itself - GonogoAddon no longer builds
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
            if (_recorder == null || _sessionPath == null)
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
