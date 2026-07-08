// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using UnityEngine;

namespace Gonogo.Kos
{
    /// <summary>
    /// Drains <see cref="Dispatcher"/> once per Unity frame, on the KSP
    /// main thread — the ONLY place a kOS API call from this uplink may
    /// happen (local_docs/telemetry-mod/kos-migration-spec.md §2). Owned
    /// by <see cref="KosExtension"/>, which instantiates exactly one of
    /// these on a dedicated, <c>DontDestroyOnLoad</c> GameObject during
    /// <see cref="KosExtension.Register"/>.
    ///
    /// Deliberately NOT <c>[KSPAddon]</c>-annotated: that attribute only
    /// controls KSP's own auto-instantiation at defined scene-load stages,
    /// and Gonogo.Kos is a separately-deployed, optional uplink with no
    /// compile-time hook into core Gonogo's addon to auto-instantiate
    /// alongside. Instead this component is added programmatically from
    /// <see cref="KosExtension.Register"/> — a call the
    /// <c>ISitrepUplink</c> contract already guarantees happens on the
    /// main thread — so no separate KSPAddon entry point is needed for P0.
    /// (Getting <see cref="KosExtension"/> registered into a live,
    /// running <c>ChannelEngine</c> at all is itself deferred — see
    /// <see cref="KosExtension"/>'s doc comment.)
    /// </summary>
    public sealed class KosMainThreadDispatcherAddon : MonoBehaviour
    {
        public MainThreadDispatcher? Dispatcher { get; set; }

        private void Update()
        {
            Dispatcher?.Drain();
        }
    }
}
