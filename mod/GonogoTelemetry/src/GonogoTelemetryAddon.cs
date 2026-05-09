using System;
using System.Collections.Generic;
using Telemachus;
using UnityEngine;

namespace GonogoTelemetry
{
    /// <summary>
    /// Phase 1 entry point — registers the gonogo telemetry handlers
    /// with Telemachus's PluginRegistration once on game start. See
    /// `local_docs/telemachus_extension_plan.md` for the roadmap; the
    /// handlers registered here are the read-only career-view slice.
    ///
    /// Lifecycle: KSPAddon.Startup.Instantly fires the moment the game
    /// loads (same scene Telemachus uses), and we run `Once = true` so
    /// the registration happens exactly once per process even if the
    /// player switches scenes. Telemachus's PluginManager dedupes by
    /// command-name internally so a second registration is a no-op, but
    /// we don't rely on that.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Instantly, true)]
    public class GonogoTelemetryAddon : MonoBehaviour
    {
        public void Awake()
        {
            // Survive scene transitions. Without DontDestroyOnLoad, even
            // `KSPAddon(..., once: true)` lets Unity destroy the
            // GameObject during scene loads, which silently kills the
            // Update loop that drains our deferred-action queue. The
            // plugin handlers stay registered with Telemachus's
            // PluginManager (independent lifetime), so they keep
            // receiving HTTP requests and queueing actions — but
            // nothing drains them. Result: actions look successful
            // (handlers return 0) but no state change in-game.
            // Telemachus's own TelemachusBehaviour calls this for the
            // same reason; mirror it.
            DontDestroyOnLoad(this);

            // Telemachus's PluginRegistration.Manager is initialised by
            // its own KSPAddon. If we somehow run before it (load order
            // is not strictly defined in KSP), the Register call throws.
            // Guard with a coroutine-style retry: try now, then on every
            // Update tick until it works. Cheap because the success path
            // is the very first frame after Telemachus has loaded.
            TryRegister();
        }

        public void Update()
        {
            DrainDeferred();
            if (registered) return;
            TryRegister();
        }

        private bool registered = false;

        // Deferred-action queue.  Action handlers run on Telemachus's HTTP /
        // WS listener threads, but KSP scene transitions (StartWithNewLaunch,
        // RevertToPrelaunch, recovery) require main-thread dispatch.
        // Telemachus solves this internally via `queueDelayed`; the plugin
        // can't reach into that machinery so we run our own queue, drained
        // on each Update tick of this MonoBehaviour. Same pattern, less
        // ceremony.
        private static readonly Queue<Action> deferred = new Queue<Action>();
        private static readonly object deferredLock = new object();

        public static void Defer(Action action)
        {
            if (action == null) return;
            lock (deferredLock) deferred.Enqueue(action);
        }

        private static void DrainDeferred()
        {
            // Move pending actions out of the lock before invoking them so
            // a handler that re-enqueues doesn't deadlock or starve.
            Action[] batch;
            lock (deferredLock)
            {
                if (deferred.Count == 0) return;
                batch = deferred.ToArray();
                deferred.Clear();
            }
            foreach (var action in batch)
            {
                try { action(); }
                catch (Exception ex)
                {
                    Debug.LogError("[GonogoTelemetry] Deferred action threw: " + ex);
                }
            }
        }

        private void TryRegister()
        {
            if (PluginRegistration.Manager == null) return;
            try
            {
                PluginRegistration.Register(new TechTreeApi());
                PluginRegistration.Register(new KscApi());
                PluginRegistration.Register(new ScienceApi());
                PluginRegistration.Register(new ContractsApi());
                PluginRegistration.Register(new LaunchApi());
                registered = true;
                Debug.Log("[GonogoTelemetry] Registered with Telemachus.");
            }
            catch (System.Exception ex)
            {
                Debug.LogError("[GonogoTelemetry] Registration failed: " + ex);
                // Latch so we don't spam the log every Update — the operator
                // can re-launch KSP to retry.
                registered = true;
            }
        }
    }
}
