// GonogoMechJebUplink: GPLv3. See GonogoMechJebUplink.csproj's header comment
// for the licence/linkage rationale.
//
// The KSP/Unity/MechJeb2-touching half of MechJebUplink. See MechJebUplink.cs's
// class doc comment for the full rationale: this file exists so
// GonogoMechJebUplink.Tests can Compile-Include MechJebUplink.cs's
// MechJeb2-free half without ever needing MechJeb2.dll/UnityEngine.dll
// reference assemblies (which don't exist in a headless/CI build) -- the
// GonogoMechJebUplink.Tests.csproj simply does not list this file. The
// production GonogoMechJebUplink.csproj compiles both halves together as
// usual (SDK-style wildcard globbing), so nothing here changes for a
// live-game build.

using System;
using MuMech;
using Sitrep.Contract;
using UnityEngine;

namespace Gonogo.MechJebUplink
{
    public sealed partial class MechJebUplink
    {
        private MechJebController? _controller;
        private MechJebMainThreadDispatcherAddon? _boundAddon;

        /// <summary>
        /// Implements the seam declared in MechJebUplink.cs: installs the
        /// real Debug.LogError sink and the real GameObject/addon binder for
        /// a production instance (the public parameterless ctor's path
        /// only, see the ctor's useProductionDefaults gate).
        /// </summary>
        partial void InstallProductionDefaults()
        {
            _bindDispatcherAddon = BindRealAddon;
            _logError = LogErrorToUnity;
        }

        // Named static helper (not an inline lambda) so ONLY this method's
        // body references UnityEngine: a headless test that never invokes it
        // never needs UnityEngine loaded.
        private static void LogErrorToUnity(string message) => Debug.LogError(message);

        partial void RegisterMechJebBindings(IUplinkHost host)
        {
            _bindDispatcherAddon(Dispatcher);

            MechJebGuardResult guard;
            try
            {
                guard = MechJebVersionGuard.Probe(typeof(MechJebCore).Assembly);
            }
            catch (Exception ex)
            {
                guard = MechJebGuardResult.Fail($"version-guard probe threw: {ex.Message}");
            }

            if (!guard.IsAvailable)
            {
                // Fail-soft, made VISIBLE (mirrors ScansatUplink/KosExtension):
                // a guard failure must never silently strand mechjeb.* commands
                // with no handler and no trace of why.
                Debug.LogWarning("[Gonogo.MechJebUplink] MechJeb uplink UNAVAILABLE: "
                    + (guard.Reason ?? "MechJeb2 unavailable")
                    + " (all mechjeb.* commands disabled)");
                _unavailableReason = guard.Reason ?? "MechJeb2 unavailable";
                host.SetAvailability(Availability.Unavailable(guard.Reason ?? "MechJeb2 unavailable"));
                // No command handlers registered: the engine's DispatchCommand
                // fails soft (CommandErrorCode) against an unregistered/
                // unavailable command, matching KosExtension's identical
                // inert-when-absent early return.
                return;
            }

            _controller = new MechJebController();
            host.AddCommandHandler<MechJebAscentArgs, CommandResult>(
                MechJebChannels.EngageAscentAutopilotCommand,
                args => RunOnMainThread(() => _controller!.EngageAscent(args)));
            host.AddCommandHandler<MechJebNoArgs, CommandResult>(
                MechJebChannels.ExecuteNextNodeCommand,
                args => RunOnMainThread(() => _controller!.ExecuteNextNode(args)));
            host.AddCommandHandler<MechJebNoArgs, CommandResult>(
                MechJebChannels.LandAtTargetCommand,
                args => RunOnMainThread(() => _controller!.LandAtTarget(args)));
        }

        private void BindRealAddon(MainThreadDispatcher dispatcher)
        {
            var go = new GameObject("Gonogo.MechJebUplink.Dispatcher");
            UnityEngine.Object.DontDestroyOnLoad(go);
            var addon = go.AddComponent<MechJebMainThreadDispatcherAddon>();
            addon.Dispatcher = dispatcher;
            _boundAddon = addon;
        }
    }
}
