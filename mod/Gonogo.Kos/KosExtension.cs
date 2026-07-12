// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Sitrep.Host;
using UnityEngine;
using Sitrep.Contract;
using kOS.Module;
using kOS.Safe.Screen;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Gonogo.Kos.Tests")]

namespace Gonogo.Kos
{
    /// <summary>
    /// The kOS bridge Uplink. P0 stood up the main-thread dispatch spine
    /// (<see cref="MainThreadDispatcher"/>, spec §2). <b>P1 adds the compute
    /// feed:</b> the <c>kos.processors</c> CPU listing
    /// (<c>kOSProcessor.AllInstances()</c>, spec §5), the
    /// <c>kos.compute.&lt;id&gt;.&lt;field&gt;</c> dynamic feed captured at
    /// source via the observe-only <c>ScreenBuffer.Print</c> Harmony postfix
    /// (<see cref="KosComputeHarmony"/>, spec §4(b)), the <c>RUNPATH</c>
    /// trigger command (<c>kos.exec</c>/<c>kos.dispatchNow</c>, spec §4(a)),
    /// and the version guard (<see cref="KosVersionGuard"/>, spec §7). P2-P4
    /// (files / terminal / widgets) are NOT started.
    ///
    /// <para><b>Every kOS call runs on the KSP main thread</b> (spec §2): CPU
    /// enumeration and the <c>RUNPATH</c> injection route through
    /// <see cref="Dispatcher"/>; the compute postfix is already on the main
    /// thread inside kOS's <c>PRINT</c>. The engine's own capture-on-main /
    /// handle-on-Courier seam (<see cref="IUplinkHost.AddSampledSource"/>)
    /// carries the processor listing across to the Courier thread.</para>
    ///
    /// <para><b>Live-KSP validation pending.</b> The kOS-touching paths
    /// (AllInstances reads, the Print postfix round-trip, the RUNPATH inject)
    /// compile against the linked kOS assemblies but cannot be exercised
    /// without a running KSP+kOS; the pure logic (parse / accumulate / version
    /// guard) is fully headlessly tested — see <c>Gonogo.Kos.Tests</c>.</para>
    /// </summary>
    [SitrepUplink("kos")]
    public sealed class KosExtension : ISitrepUplink
    {
        private readonly Action<MainThreadDispatcher> _bindDispatcherAddon;

        private readonly KosComputeAccumulator _accumulator = new KosComputeAccumulator();
        private IDynamicChannelSource? _computeSource;
        private IChannelPublisher? _processorsPublisher;

        // Interactive terminal-over-Uplink: the kos.terminal.<coreId> screen
        // downlink + single-owner keystroke/resize/open/close commands that
        // replace the standalone telnet proxy. Null until Register wires them.
        private IDynamicChannelSource? _terminalSource;
        private KosTerminalManager? _terminalManager;
        private KosMainThreadDispatcherAddon? _boundAddon;

        // Subscription short-circuit for OnPrint (adversarial-review I1): true
        // iff at least one kos.compute.* topic currently has a subscriber. Wired
        // to the host's subscription mirror in Register; null (→ treated as "no
        // gate") only in headless tests that don't call Register.
        private Func<bool>? _computeSubscribed;

        // Reverse-map from a ScreenBuffer to the owning CPU's KOSCoreId,
        // resolved ONLY when a [KOSDATA] block completes (never per fragment).
        // Injectable so headless tests can count invocations and avoid the live
        // kOSProcessor.AllInstances() call; defaults to the real reverse-map.
        internal Func<object, int> CoreIdResolver { get; set; } = ResolveCoreId;

        // Error sink for the command main-thread path. Kept as a delegate (not a
        // direct UnityEngine.Debug call inside the dispatched lambda) so that
        // lambda body carries NO UnityEngine type reference and therefore JITs
        // in a headless test runtime — Debug.LogError is resolved lazily, only
        // if actually invoked. Defaults to Debug.LogError in production.
        private readonly Action<string> _logError;

        public MainThreadDispatcher Dispatcher { get; }

        public KosExtension() : this(null, null)
        {
        }

        internal KosExtension(MainThreadDispatcher? dispatcher, Action<MainThreadDispatcher>? bindDispatcherAddon)
        {
            Dispatcher = dispatcher ?? new MainThreadDispatcher(
                ex => Debug.LogError("[Gonogo.Kos] dispatched action threw: " + ex));
            _bindDispatcherAddon = bindDispatcherAddon ?? BindRealAddon;
            _logError = LogErrorToUnity;
        }

        // Named static helper (not an inline lambda) so ONLY this method's body
        // references UnityEngine — a headless test that never invokes it never
        // needs UnityEngine loaded.
        private static void LogErrorToUnity(string message) => Debug.LogError(message);

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "kos",
            Version = "0.2.0",
            Channels = new List<ChannelDeclaration>
            {
                // CPU listing — vessel-derived (which CPUs exist), rides the
                // delay clock like every other vessel-sourced channel.
                new ChannelDeclaration
                {
                    Topic = KosChannels.ProcessorsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                },
                // P2: kos.file. The kos.terminal.<coreId> screen downlink is a
                // ReliableOrdered dynamic namespace registered in Register (like
                // the compute feed), not a static manifest channel.
            },
            Commands = new List<CommandDeclaration>
            {
                // RUNPATH trigger — DELAYED, single-owner (spec §3.0 flag is
                // P3; P1 couriers normally). Reachability + idle-prompt guard
                // are re-checked at delivery, on the main thread.
                new CommandDeclaration { Command = KosChannels.ExecCommand, Delayed = true },
                new CommandDeclaration { Command = KosChannels.DispatchNowCommand, Delayed = true },
                new CommandDeclaration { Command = KosChannels.ReEnableCommand, Delayed = true },
                // Interactive terminal uplink — all DELAYED (keystrokes ride
                // gonogo's SignalDelay to the craft; the lease-token + idle
                // guards are re-checked at delivery on the main thread).
                new CommandDeclaration { Command = KosChannels.TerminalOpenCommand, Delayed = true },
                new CommandDeclaration { Command = KosChannels.KeystrokeCommand, Delayed = true },
                new CommandDeclaration { Command = KosChannels.TerminalResizeCommand, Delayed = true },
                new CommandDeclaration { Command = KosChannels.TerminalCloseCommand, Delayed = true },
            },
        };

        public void Register(IUplinkHost host)
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

        // ----------------------------------------------------------------
        // Interactive terminal commands — dispatched on the Courier thread,
        // marshalled to the KSP main thread (same drop-not-run discipline as
        // Exec). The KosTerminalManager holds the lease + screen state; every
        // call here runs on the main thread so no locking is needed.
        // ----------------------------------------------------------------

        private CommandResult TerminalOpen(KosTerminalOpenArgs args)
        {
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return RunOnMainThread(() =>
                _terminalManager?.Open(args.CoreId, args.LeaseToken) ?? CommandResult.Fail(CommandErrorCode.Unknown));
        }

        private CommandResult Keystroke(KosKeystrokeArgs args)
        {
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return RunOnMainThread(() =>
                _terminalManager?.Keystroke(args.CoreId, args.LeaseToken, args.Chars) ?? CommandResult.Fail(CommandErrorCode.Unknown));
        }

        private CommandResult TerminalResize(KosTerminalResizeArgs args)
        {
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return RunOnMainThread(() =>
                _terminalManager?.Resize(args.CoreId, args.LeaseToken, args.Cols, args.Rows) ?? CommandResult.Fail(CommandErrorCode.Unknown));
        }

        private CommandResult TerminalClose(KosTerminalCloseArgs args)
        {
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            return RunOnMainThread(() =>
                _terminalManager?.Close(args.CoreId, args.LeaseToken) ?? CommandResult.Fail(CommandErrorCode.Unknown));
        }

        /// <summary>
        /// Test-only: wire the compute publish target and the subscription gate
        /// directly, bypassing <see cref="Register"/> (which needs a live
        /// kOS/Unity process for the version guard + Harmony install). Pair with
        /// <see cref="CoreIdResolver"/> to exercise <see cref="OnPrint"/>
        /// headlessly.
        /// </summary>
        internal void WireComputeForTests(IDynamicChannelSource computeSource, Func<bool>? computeSubscribed)
        {
            _computeSource = computeSource;
            _computeSubscribed = computeSubscribed;
        }

        // ----------------------------------------------------------------
        // kos.processors
        // ----------------------------------------------------------------

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

        /// <summary>COURIER-THREAD handle: publish the captured list. Touches no kOS API.</summary>
        internal void HandleProcessors(object? captured)
        {
            if (captured is ProcessorsCapture capture)
            {
                _processorsPublisher?.Publish(capture.List, capture.Ut);
            }
        }

        /// <summary>Plain cross-thread payload bundle — no live kOS references (mirrors CommsCoreUplink.CommsCapture).</summary>
        private sealed class ProcessorsCapture
        {
            public double Ut;
            public List<KosProcessorInfo> List = new List<KosProcessorInfo>();
        }

        // ----------------------------------------------------------------
        // kos.compute — the Print-postfix capture path (main thread)
        // ----------------------------------------------------------------

        /// <summary>
        /// The <see cref="KosComputeHarmony.Sink"/> — runs on the KSP main
        /// thread synchronously inside kOS's <c>PRINT</c>, on EVERY kerboscript
        /// <c>PRINT</c> fragment, so it must be as close to free as possible on
        /// the common path. It:
        /// <list type="number">
        /// <item>short-circuits immediately when no <c>kos.compute.*</c>
        /// subscriber exists (adversarial-review I1) — no accumulation, no CPU
        /// reverse-map, no allocation;</item>
        /// <item>otherwise accumulates the fragment keyed by the
        /// <c>ScreenBuffer</c> reference already in hand (NOT by a resolved CPU
        /// id — so <c>kOSProcessor.AllInstances()</c> is never walked per
        /// fragment);</item>
        /// <item>resolves the owning CPU's <c>KOSCoreId</c> exactly ONCE, only
        /// when at least one <c>[KOSDATA]</c> block has completed and is about
        /// to publish (spec §4.2), stamps it onto the completed blocks, and
        /// publishes each field to <c>kos.compute.&lt;topic&gt;.&lt;field&gt;</c>.</item>
        /// </list>
        /// Must be cheap and non-blocking (it is inside PRINT).
        /// </summary>
        internal void OnPrint(object screen, string text)
        {
            if (_computeSource == null || screen == null || string.IsNullOrEmpty(text))
            {
                return;
            }

            // I1: burn nothing while no client is looking. Every terminal PRINT
            // hits this; without the gate even a zero-subscriber session would
            // accumulate + reverse-map on the main thread.
            if (_computeSubscribed != null && !_computeSubscribed())
            {
                return;
            }

            var blocks = _accumulator.Append(screen, text);
            if (blocks.Count == 0)
            {
                // Common case for a fragment that only extends an open block (or
                // ordinary terminal output): no CPU lookup, no publish.
                return;
            }

            // A block completed — NOW resolve the emitting CPU once (spec §4.2).
            int coreId = CoreIdResolver(screen);
            foreach (var block in blocks)
            {
                block.CoreId = coreId;
                foreach (var kv in block.Fields)
                {
                    var sub = KosChannels.ComputeFieldSubTopic(block.Topic, kv.Key);
                    _computeSource.Publisher(sub).Publish(kv.Value, 0.0);
                }
            }
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

        // ----------------------------------------------------------------
        // Commands — dispatched on the Courier thread, marshalled to main
        // ----------------------------------------------------------------

        /// <summary>Bounded wait for a main-thread kOS call to complete before the Courier gives up (F2 backstop analogue). Instance field so headless tests can shorten it.</summary>
        internal TimeSpan CommandMainThreadTimeout { get; set; } = TimeSpan.FromSeconds(5);

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

        private CommandResult ReEnable(KosReEnableArgs args)
        {
            // The per-topic breaker/sticky-cache lives engine-side on the
            // subscription gate (spec §4.4); at the mod boundary a re-enable is
            // a no-op ack in P1 (the breaker state is not yet mod-owned) — the
            // command exists so the client's reEnable affordance has a real,
            // typed target rather than a dropped call. Wiring the mod-side
            // breaker is P2 scope.
            _ = args;
            return CommandResult.Ok();
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

        /// <summary>
        /// Marshals <paramref name="work"/> onto the main-thread dispatcher and
        /// blocks the Courier thread until it completes or
        /// <see cref="CommandMainThreadTimeout"/> elapses (returning
        /// <see cref="CommandErrorCode.Timeout"/>). Any exception from
        /// <paramref name="work"/> becomes a typed <c>Unknown</c> failure — a
        /// command must always return a structured result, never throw.
        ///
        /// <para><b>Timeout is drop-not-run</b> (adversarial-review M1, mirroring
        /// the engine's F2/F3 fix): the naive <c>using var done</c> form had two
        /// faults when the dispatcher drained the action AFTER the 5s wait
        /// expired — (1) the deferred action's <c>Set()</c> hit an already-
        /// disposed handle (a spurious <see cref="ObjectDisposedException"/>),
        /// and (2) the kOS <c>RUNPATH</c> mutation STILL executed, seconds after
        /// the client was told <see cref="CommandErrorCode.Timeout"/> — so a
        /// client retry double-fired the script. Here the waiter marks the job
        /// <see cref="MainThreadJob.Abandoned"/> on timeout and does NOT dispose
        /// the handle; the dispatcher then DROPS an abandoned job (never runs
        /// <paramref name="work"/>) and disposes the handle itself. Exactly one
        /// side disposes, and no <c>Set()</c> ever lands on a disposed handle.</para>
        /// </summary>
        internal CommandResult RunOnMainThread(Func<CommandResult> work)
        {
            var job = new MainThreadJob();
            Dispatcher.Dispatch(() =>
            {
                // Drop if the waiter already timed out: running the kOS mutation
                // now would fire RUNPATH after the client got Timeout (M1). The
                // waiter left disposal of the handle to us on that path.
                if (job.Abandoned)
                {
                    job.Done.Dispose();
                    return;
                }

                try
                {
                    job.Result = work();
                }
                catch (Exception ex)
                {
                    _logError("[Gonogo.Kos] command main-thread work threw: " + ex);
                    job.Result = CommandResult.Fail(CommandErrorCode.Unknown);
                }
                finally
                {
                    job.Done.Set();
                    // If the waiter abandoned this job WHILE work ran (flag flipped
                    // after the top-of-action check), nobody will observe the
                    // result or dispose the handle — so this side owns disposal.
                    if (job.Abandoned)
                    {
                        job.Done.Dispose();
                    }
                }
            });

            if (!job.Done.Wait(CommandMainThreadTimeout))
            {
                // Do NOT dispose here — the dispatcher may still dequeue this job
                // and would Set()/Dispose() it; a Set() on a disposed handle
                // throws. The abandoned flag routes both the drop and the
                // disposal to whichever side drains the job.
                job.Abandoned = true;
                return CommandResult.Fail(CommandErrorCode.Timeout);
            }

            try
            {
                return job.Result ?? CommandResult.Fail(CommandErrorCode.Unknown);
            }
            finally
            {
                // Completed path: the dispatcher's Set() has already returned and
                // the action left Abandoned false, so nothing else touches Done.
                job.Done.Dispose();
            }
        }

        /// <summary>
        /// One <see cref="RunOnMainThread"/> marshaled call. Mirrors the engine's
        /// <c>MainThreadCommand</c>: the <see cref="Abandoned"/> flag (set by the
        /// waiter on timeout) is the sole signal that routes both "drop the work"
        /// and "who disposes <see cref="Done"/>" between the waiter and the
        /// dispatcher, so the handle is disposed exactly once and never
        /// <c>Set()</c>-after-dispose.
        /// </summary>
        private sealed class MainThreadJob
        {
            public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);
            public volatile bool Abandoned;
            public CommandResult? Result;
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
