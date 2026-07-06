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
    /// <see cref="FixedUpdate"/> builds the <c>system.bodies</c> payload, it
    /// hands the finished object straight to <see cref="GonogoBodiesServer.Tick"/>,
    /// which only touches primitives/the payload and an explicit job queue
    /// on ITS side too - the Courier/serialization/socket work all happens
    /// off the main thread, per <see cref="GonogoBodiesServer"/>'s doc comment.
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

        private KspHost? _host;
        private Recorder? _recorder;
        private GonogoBodiesServer? _server;
        private bool _shutDown;

        private void Awake()
        {
            DontDestroyOnLoad(gameObject);

            try
            {
                _host = new KspHost();
                _recorder = new Recorder(_host);
                _server = new GonogoBodiesServer(BindUri);
                _server.Start();
                Debug.Log("[Gonogo] Started - serving " + SystemViewProvider.Topic + " on " + BindUri);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] Failed to start: " + ex);
            }
        }

        private void FixedUpdate()
        {
            if (_host == null || _recorder == null || _server == null)
            {
                return;
            }

            try
            {
                // Recorder.Tick() calls host.Sample()/NowUt() itself and
                // appends the raw snapshot to the session timeline; the
                // System-View payload below is a SEPARATE Sample() call
                // (KspSnapshot has no mutable shared state, so sampling
                // twice per tick is harmless - just two independent reads
                // of the same live game state) mapped through the KSP-free
                // SystemViewProvider before it ever reaches the server.
                _recorder.Tick();

                var snapshot = _host.Sample();
                var payload = SystemViewProvider.BuildSystemBodies(snapshot);
                if (payload != null)
                {
                    _server.Tick(_host.NowUt(), payload);
                }
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
                _server?.Stop();
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] Error stopping server: " + ex);
            }

            SaveRecording();

            try
            {
                _host?.Unhook();
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] Error unhooking GameEvents: " + ex);
            }
        }

        private void SaveRecording()
        {
            if (_recorder == null)
            {
                return;
            }

            try
            {
                var dir = Path.Combine(KSPUtil.ApplicationRootPath, "GameData", "Gonogo", "PluginData", "recordings");
                Directory.CreateDirectory(dir);
                var path = Path.Combine(dir, "session-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + ".json");
                _recorder.Save(path);
                Debug.Log("[Gonogo] Saved session recording to " + path);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] Failed to save recording: " + ex);
            }
        }
    }
}
