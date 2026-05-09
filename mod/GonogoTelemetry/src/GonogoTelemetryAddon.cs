using Telemachus;
using UnityEngine;

namespace GonogoTelemetry
{
    /// <summary>
    /// Phase 1 entry point — registers the gonogo telemetry plugin with
    /// Telemachus's PluginRegistration once on game start. The single key
    /// `tech.unlockedIds` proves the pipeline end-to-end before we expand
    /// to the full set described in
    /// `local_docs/telemachus_extension_plan.md`.
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
            if (registered) return;
            TryRegister();
        }

        private bool registered = false;

        private void TryRegister()
        {
            if (PluginRegistration.Manager == null) return;
            try
            {
                PluginRegistration.Register(new TechTreeApi());
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
