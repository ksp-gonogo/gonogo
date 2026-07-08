// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using System;
using System.Collections.Generic;
using Sitrep.Host;
using UnityEngine;
using Sitrep.Contract;

namespace Gonogo.Kos
{
    /// <summary>
    /// P0 scaffold for the kOS bridge uplink — see
    /// local_docs/telemetry-mod/kos-migration-spec.md's "Phased
    /// milestones" table, row P0: "links kOS; the §2 main-thread dispatch
    /// queue + Update() drain; version-guard skeleton ...; a smoke
    /// round-trip". Registers as a normal <see cref="ISitrepUplink"/> —
    /// same shape as <c>Gonogo.KSP.SystemUplink</c>/<c>VesselUplink</c>
    /// — but ships an EMPTY manifest: no channels, no commands yet (P1
    /// adds <c>kos.processors</c> + <c>kos.compute.*</c>; P2 adds
    /// <c>kos.file</c>/<c>kos.exec</c>; P3 adds the terminal).
    ///
    /// Its only job right now is standing up the
    /// <see cref="MainThreadDispatcher"/> that every later phase's kOS
    /// calls (input inject, screen poll, file I/O,
    /// <c>kOSProcessor.AllInstances()</c>, the <c>Print</c>-postfix
    /// handoff) will route through — see the dispatcher's own doc comment
    /// and spec §2.
    ///
    /// <b>Deferred: live registration into the running core engine.</b>
    /// <see cref="Register"/> only creates and wires this uplink's OWN
    /// draining addon (<see cref="KosMainThreadDispatcherAddon"/>); it
    /// does not reach into <c>Gonogo.KSP.GonogoAddon</c> or attempt to
    /// self-register into the live core <c>ChannelEngine</c>. Two
    /// compounding reasons:
    /// <list type="bullet">
    /// <item>Packaging: GonogoKos is a SEPARATELY deployed, optional
    /// uplink (its own GameData folder, its own CKAN/SpaceDock
    /// listing — see Gonogo.Kos.csproj's header). Core
    /// <c>Gonogo.KSP.csproj</c> cannot compile-reference this assembly
    /// (that would force-bundle it and make the uplink mandatory), so
    /// there is no static call site in core that can simply
    /// <c>new KosExtension()</c> the way <c>GonogoAddon.Awake()</c> does
    /// for its five built-in uplinks today.</item>
    /// <item>Thread safety: <c>ChannelEngine.RegisterUplink</c> mutates
    /// un-locked state (<c>_availability</c>, <c>_channelDeclarations</c>,
    /// ...) that the Courier background thread reads once
    /// <c>ChannelEngine.Start()</c> has run. It is only safe to call
    /// BEFORE <c>Start()</c>. Two independently-<c>[KSPAddon]</c>
    /// -instantiated mods have no ordering guarantee against each other's
    /// <c>Awake()</c>/<c>Start()</c> — a naive "uplink addon polls for
    /// core and self-registers" scheme can easily land its
    /// <c>RegisterUplink</c> call after core's <c>Start()</c>, racing
    /// the Courier thread.</item>
    /// </list>
    /// A real fix needs a thread-safe, post-<c>Start()</c>-safe
    /// registration path on <c>ChannelEngine</c> (e.g. a queued
    /// registration the Courier loop itself drains) plus a discovery
    /// mechanism core can use to find separately-deployed uplinks
    /// (e.g. a reflection scan of loaded assemblies for
    /// <see cref="ISitrepUplink"/> implementors). Both are out of
    /// scope for this P0 scaffold and are flagged as P1+ follow-up work.
    ///
    /// Loads and no-ops cleanly with no kOS CPUs present: P0 never calls
    /// <c>kOSProcessor.AllInstances()</c> or any other kOS member at all
    /// — the kOS/Harmony references exist only so this assembly compiles
    /// against the full P1+ dependency set (see the csproj comment).
    /// </summary>
    public sealed class KosExtension : ISitrepUplink
    {
        private readonly Action<MainThreadDispatcher> _bindDispatcherAddon;

        /// <summary>
        /// The dispatch spine every P1+ kOS call routes through via
        /// <c>Dispatcher.Dispatch(() =&gt; ...)</c>. Created in the
        /// constructor (not <see cref="Register"/>) so it exists — and is
        /// safe to hand to a background thread — for this uplink's
        /// full lifetime, not just after engine registration.
        /// </summary>
        public MainThreadDispatcher Dispatcher { get; }

        /// <summary>Production entry point — wires the real Unity-touching draining addon.</summary>
        public KosExtension() : this(null, null)
        {
        }

        /// <summary>
        /// Test seam: <paramref name="dispatcher"/> and
        /// <paramref name="bindDispatcherAddon"/> let
        /// <c>Gonogo.Kos.Tests</c> exercise <see cref="Register"/> without
        /// a live Unity runtime — instantiating a real <c>GameObject</c>
        /// outside a running KSP/Unity process throws. Production code
        /// always uses the parameterless constructor.
        /// </summary>
        internal KosExtension(MainThreadDispatcher? dispatcher, Action<MainThreadDispatcher>? bindDispatcherAddon)
        {
            Dispatcher = dispatcher ?? new MainThreadDispatcher(
                ex => Debug.LogError("[Gonogo.Kos] dispatched action threw: " + ex));
            _bindDispatcherAddon = bindDispatcherAddon ?? BindRealAddon;
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "kos",
            Version = "0.1.0",
            // P1: kos.processors, kos.compute.<id>.*, kos.compute.<id>.status, kos.exec/dispatchNow, kos.reEnable.
            // P2: kos.file (archive + local volumes).
            // P3: kos.terminal.<sessionId> (reliable-ordered), kos.terminal.open/close/resize, kos.keystroke.
            Channels = new List<ChannelDeclaration>(),
            Commands = new List<CommandDeclaration>(),
        };

        public void Register(IUplinkHost host)
        {
            // Nothing to bind against `host` yet — P0 ships no channel
            // sources or command handlers (empty manifest above). The one
            // thing this uplink does on registration is stand up its
            // own main-thread drain loop, independent of the host/engine
            // (see the "deferred" note in this class's doc comment for why
            // it does not also try to reach the live core engine here).
            _bindDispatcherAddon(Dispatcher);
        }

        private static void BindRealAddon(MainThreadDispatcher dispatcher)
        {
            var go = new GameObject("Gonogo.Kos.Dispatcher");
            UnityEngine.Object.DontDestroyOnLoad(go);
            var addon = go.AddComponent<KosMainThreadDispatcherAddon>();
            addon.Dispatcher = dispatcher;
        }
    }
}
