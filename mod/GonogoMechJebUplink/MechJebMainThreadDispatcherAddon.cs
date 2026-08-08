// GonogoMechJebUplink: GPLv3. See GonogoMechJebUplink.csproj's header comment
// for the licence/linkage rationale.

using UnityEngine;

namespace Gonogo.MechJebUplink
{
    /// <summary>
    /// Drains <see cref="Dispatcher"/> once per Unity frame, on the KSP main
    /// thread: the ONLY place a MechJeb2 API call from this uplink may
    /// happen. Owned by <see cref="MechJebUplink"/>, which instantiates
    /// exactly one of these on a dedicated, <c>DontDestroyOnLoad</c>
    /// GameObject during <see cref="MechJebUplink.Register"/>. Mirrors
    /// <c>GonogoKosUplink.KosMainThreadDispatcherAddon</c> exactly, minus its
    /// terminal-poll cadence (this Uplink has no sampled/polled feed).
    ///
    /// Deliberately NOT <c>[KSPAddon]</c>-annotated: that attribute only
    /// controls KSP's own auto-instantiation at defined scene-load stages,
    /// and GonogoMechJebUplink is a separately-deployed, optional uplink with
    /// no compile-time hook into core Gonogo's addon to auto-instantiate
    /// alongside. Instead this component is added programmatically from
    /// <see cref="MechJebUplink.Register"/>, a call the
    /// <c>ISitrepUplink</c> contract already guarantees happens on the main
    /// thread.
    /// </summary>
    public sealed class MechJebMainThreadDispatcherAddon : MonoBehaviour
    {
        public MainThreadDispatcher? Dispatcher { get; set; }

        private void Update()
        {
            Dispatcher?.Drain();
        }
    }
}
