// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.
//
// The KSP/Unity/kOS-touching half of KosExtension. See KosExtension.cs's
// class doc comment for the full rationale: this file exists so
// Gonogo.Kos.Tests can Compile-Include KosExtension.cs's KSP-free half
// without ever needing kOS.dll/UnityEngine.dll reference assemblies (which
// don't exist in a headless/CI build) — the Gonogo.Kos.Tests.csproj simply
// does not list this file. The production Gonogo.Kos.csproj compiles both
// halves together as usual (SDK-style wildcard globbing), so nothing here
// changes for a live-game build.

using System;
using System.Collections.Generic;
using System.Linq;
using kOS.Module;
using kOS.Safe.Screen;
using Sitrep.Contract;
using UnityEngine;

namespace Gonogo.Kos
{
    public sealed partial class KosExtension
    {
        // Held so Register can attach the terminal poll once the manager
        // exists (the addon drives both the dispatcher drain and the
        // ~20 Hz terminal downlink on the main thread). KSP/Unity type, so
        // it lives in this half of the partial class.
        private KosMainThreadDispatcherAddon? _boundAddon;

        /// <summary>
        /// Implements the seam declared in KosExtension.cs: installs the real
        /// Debug.LogError sink, the real GameObject/addon binder, and the real
        /// kOSProcessor-reverse-map CoreIdResolver for a production instance
        /// (the public parameterless ctor's path only — see the ctor's
        /// useProductionDefaults gate).
        /// </summary>
        partial void InstallProductionDefaults()
        {
            _bindDispatcherAddon = BindRealAddon;
            _logError = LogErrorToUnity;
            CoreIdResolver = ResolveCoreId;
        }

        // Named static helper (not an inline lambda) so ONLY this method's body
        // references UnityEngine — a headless test that never invokes it never
        // needs UnityEngine loaded.
        private static void LogErrorToUnity(string message) => Debug.LogError(message);

        partial void RegisterKspBindings(IUplinkHost host)
        {
            _bindDispatcherAddon(Dispatcher);

            KosGuardResult guard;
            try
            {
                guard = KosVersionGuard.Probe(typeof(kOSProcessor).Assembly, typeof(ScreenBuffer).Assembly);
            }
            catch (Exception ex)
            {
                guard = KosGuardResult.Fail($"kOS version-guard probe threw: {ex.Message}");
            }

            if (!guard.IsAvailable)
            {
                host.SetAvailability(Availability.Unavailable(guard.Reason ?? "kOS unavailable"));
                // Still publish an empty CPU list so the client can render a
                // definite "no kOS" rather than a hang.
                host.AddChannelSource(KosChannels.ProcessorsTopic, _ => new List<KosProcessorInfo>());
                return;
            }

            // kos.processors — capture AllInstances() on the main thread, hand
            // the plain list to the Courier to publish (spec §2/§5).
            _processorsPublisher = host.Publisher(KosChannels.ProcessorsTopic);
            host.AddSampledSource(
                CaptureProcessors,
                HandleProcessors,
                KosChannels.ProcessorsTopic);

            // kos.compute.<id>.<field> — dynamic namespace fed by the Print
            // postfix (or the snapshot-scrape fallback when the postfix target
            // is absent). Every compute value is DELAYED (comms authority —
            // script PRINT downlink is vessel telemetry, spec §4.4).
            _computeSource = host.RegisterDynamicNamespace(
                KosChannels.ComputePrefix,
                new ChannelDeclaration
                {
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                });

            // Subscription short-circuit source for OnPrint: every kerboscript
            // PRINT flows through the postfix, but if nobody is subscribed under
            // kos.compute.* the whole capture (resolve + accumulate + publish)
            // must be skipped so a terminal-only session burns no GC on the main
            // thread (adversarial-review I1). Reads the engine's thread-safe
            // subscribed-topics mirror.
            _computeSubscribed = () => host.IsAnyTopicSubscribed(KosChannels.ComputePrefix);

            if (guard.ComputePostfixAvailable)
            {
                KosComputeHarmony.Sink = OnPrint;
                try
                {
                    KosComputeHarmony.Install();
                }
                catch (Exception ex)
                {
                    // Fall back to the snapshot-scrape path (not wired in P1 —
                    // see the known-gap note in the report). Never crash the
                    // engine on a patch failure.
                    Debug.LogError("[Gonogo.Kos] compute Print-postfix install failed: " + ex);
                    KosComputeHarmony.Sink = null;
                }
            }

            // Commands (RUNPATH trigger + breaker re-enable).
            host.AddCommandHandler<KosExecArgs, CommandResult>(KosChannels.ExecCommand, Exec);
            host.AddCommandHandler<KosExecArgs, CommandResult>(KosChannels.DispatchNowCommand, Exec);
            host.AddCommandHandler<KosReEnableArgs, CommandResult>(KosChannels.ReEnableCommand, ReEnable);

            // Interactive terminal — kos.terminal.<coreId> ReliableOrdered
            // screen downlink + single-owner keystroke/resize/open/close.
            // Replaces the standalone telnet proxy: the mod reads the CPU screen
            // in-process (spec §P3), no telnet/node-pty anywhere in the path.
            _terminalSource = host.RegisterDynamicNamespace(
                KosChannels.TerminalPrefix,
                new ChannelDeclaration
                {
                    // Reliable-ordered: terminal output is a discrete event
                    // stream — a dropped frame corrupts the buffer.
                    Delivery = Delivery.ReliableOrdered,
                    // Delayed: the screen is vessel telemetry; it rides gonogo's
                    // reveal clock exactly like vessel.flight (comms authority).
                    Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                });

            _terminalManager = new KosTerminalManager(
                knownCoreIds: CurrentCoreIds,
                isSubscribed: coreId => host.IsAnyTopicSubscribed(KosChannels.TerminalTopic(coreId)),
                publish: (coreId, frame) =>
                    _terminalSource?.Publisher(KosChannels.TerminalSubTopic(coreId)).Publish(frame, host.NowUt()),
                createScreen: coreId => new KosProcessorScreen(coreId, FindProcessor));

            // Drive the ~20 Hz downlink poll from the same main-thread addon
            // that drains the dispatcher (headless tests call Poll() directly).
            if (_boundAddon != null)
            {
                _boundAddon.Poll = _terminalManager.Poll;
            }

            host.AddCommandHandler<KosTerminalOpenArgs, CommandResult>(KosChannels.TerminalOpenCommand, TerminalOpen);
            host.AddCommandHandler<KosKeystrokeArgs, CommandResult>(KosChannels.KeystrokeCommand, Keystroke);
            host.AddCommandHandler<KosTerminalResizeArgs, CommandResult>(KosChannels.TerminalResizeCommand, TerminalResize);
            host.AddCommandHandler<KosTerminalCloseArgs, CommandResult>(KosChannels.TerminalCloseCommand, TerminalClose);
        }

        /// <summary>Current CPU <c>KOSCoreId</c>s (main thread) — the terminal manager's discovery set.</summary>
        private static IReadOnlyList<int> CurrentCoreIds()
        {
            var ids = new List<int>();
            foreach (var p in kOSProcessor.AllInstances())
            {
                if (p != null)
                {
                    ids.Add(p.KOSCoreId);
                }
            }
            return ids;
        }

        /// <summary>MAIN-THREAD capture: read <c>AllInstances()</c> into a plain, KSP-handle-free list.</summary>
        internal object? CaptureProcessors(KspSnapshot? snapshot)
        {
            var list = new List<KosProcessorInfo>();
            foreach (var p in kOSProcessor.AllInstances())
            {
                if (p == null)
                {
                    continue;
                }
                list.Add(new KosProcessorInfo
                {
                    CoreId = p.KOSCoreId,
                    Tag = string.IsNullOrEmpty(p.Tag) ? null : p.Tag,
                    HasBooted = p.HasBooted,
                    BootFilePath = p.BootFilePath?.ToString(),
                    ProcessorMode = p.ProcessorMode.ToString(),
                });
            }
            // Carry the capture UT alongside the list (mirrors
            // CommsCoreUplink.CommsCapture.Ut). Publishing at the real UT — not a
            // hardcoded 0.0 — keeps this Delayed channel on the same UT-indexed
            // timeline as every other vessel-sourced channel, so its periodic
            // keyframe cadence and the server reveal gate both work; a fixed 0.0
            // froze the emitter's keyframe clock and made a "Delayed" channel
            // reveal as if TrueNow.
            return new ProcessorsCapture { Ut = snapshot?.Ut ?? 0.0, List = list };
        }

        /// <summary>
        /// Reverse map from the postfix's <c>ScreenBuffer</c>/interpreter to
        /// the owning CPU's <c>KOSCoreId</c> (spec §4.2:
        /// <c>AllInstances().First(p =&gt; p.GetScreen() == __instance)</c>).
        /// Returns -1 when no CPU owns the screen (should not happen for a
        /// script PRINT, but fail-soft). Called ONLY on block completion — never
        /// per <c>PRINT</c> fragment — so its <c>AllInstances()</c> allocation
        /// is off the hot path.
        /// </summary>
        private static int ResolveCoreId(object screen)
        {
            foreach (var p in kOSProcessor.AllInstances())
            {
                if (p != null && ReferenceEquals(p.GetScreen(), screen))
                {
                    return p.KOSCoreId;
                }
            }
            return -1;
        }

        private CommandResult Exec(KosExecArgs args)
        {
            if (args == null || string.IsNullOrEmpty(args.ScriptId))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            return RunOnMainThread(() =>
            {
                var proc = FindProcessor(args.CoreId);
                if (proc == null)
                {
                    return CommandResult.Fail(CommandErrorCode.NotFound);
                }

                // Guard: never type into a booting or busy prompt (spec §4(a)).
                if (!proc.HasBooted || !(proc.GetScreen() is IInterpreter interp) || !interp.IsWaitingForCommand())
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
                }

                var command = "RUNPATH(\"0:/widget_scripts/" + args.ScriptId + ".ks\").";
                TypeLine(proc, command);
                return CommandResult.Ok();
            });
        }

        /// <summary>
        /// Types <paramref name="line"/> into <paramref name="proc"/>'s
        /// interpreter followed by Enter, via the pinned 4-arg
        /// <c>ProcessOneInputChar</c> overload (spec §7). <c>forceQueue: true</c>
        /// is the correct mode for a remote byte stream (preserves ordering
        /// against the interpreter's async pace). Main thread only.
        /// </summary>
        private static void TypeLine(kOSProcessor proc, string line)
        {
            var window = proc.GetWindow();
            if (window == null)
            {
                return;
            }
            foreach (var ch in line)
            {
                window.ProcessOneInputChar(ch, null, true, true);
            }
            window.ProcessOneInputChar('\r', null, true, true);
        }

        private static kOSProcessor? FindProcessor(int coreId)
        {
            return kOSProcessor.AllInstances().FirstOrDefault(p => p != null && p.KOSCoreId == coreId);
        }

        private void BindRealAddon(MainThreadDispatcher dispatcher)
        {
            var go = new GameObject("Gonogo.Kos.Dispatcher");
            UnityEngine.Object.DontDestroyOnLoad(go);
            var addon = go.AddComponent<KosMainThreadDispatcherAddon>();
            addon.Dispatcher = dispatcher;
            // Held so Register can attach the terminal poll once the manager
            // exists (the addon drives both the dispatcher drain and the
            // ~20 Hz terminal downlink on the main thread).
            _boundAddon = addon;
        }
    }
}
