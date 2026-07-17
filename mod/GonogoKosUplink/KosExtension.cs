// GonogoKosUplink — GPLv3. See GonogoKosUplink.csproj's header comment for the
// licence/linkage rationale.

using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("GonogoKosUplink.Tests")]

namespace Gonogo.KosUplink
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
    /// guard) is fully headlessly tested — see <c>GonogoKosUplink.Tests</c>.</para>
    ///
    /// <para><b>File split:</b> this file is the KSP/Unity/kOS-FREE half —
    /// everything <c>GonogoKosUplink.Tests</c> Compile-Includes directly (mirrors
    /// <c>GonogoScansatUplink</c>/<c>GonogoScansatUplink.Tests</c>'s pure-logic
    /// split). The kOS/Unity-touching half (<c>Register</c>, the
    /// <c>kOSProcessor</c>/<c>ScreenBuffer</c> reads, the real Harmony/GameObject
    /// wiring) lives in the other half of this <c>partial class</c>,
    /// <see cref="KosExtension"/> in <c>KosExtension.Ksp.cs</c>, which the test
    /// project deliberately does NOT compile — a headless build has no
    /// kOS.dll/UnityEngine.dll reference assemblies to link against. The two
    /// halves meet at <see cref="InstallProductionDefaults"/>, a partial
    /// method: implemented (real kOS/Unity wiring) in the production
    /// assembly, silently a no-op when the implementing file isn't part of
    /// the compilation (the test build) — the standard "optional partial
    /// method" behaviour, not a special-cased seam.</para>
    /// </summary>
    [SitrepUplink("kos")]
    public sealed partial class KosExtension : ISitrepUplink
    {
        // Bound in InstallProductionDefaults() (KosExtension.Ksp.cs) for a
        // production instance; a caller-supplied value (e.g. a test) is left
        // untouched — see the ctor's useProductionDefaults gate below. Never
        // readonly: the production path fills it in AFTER construction-time
        // field initialisers/params have run, from the same class's
        // KSP-touching half.
        private Action<MainThreadDispatcher> _bindDispatcherAddon;

        private readonly KosComputeAccumulator _accumulator = new KosComputeAccumulator();
        private IDynamicChannelSource? _computeSource;

        // Assigned only in RegisterKspBindings (KosExtension.Ksp.cs) — the
        // headless test build never calls Register, so the compiler can't see
        // an assignment in THIS half and warns. Harmless; suppressed rather
        // than worked around, so the CI log stays clean without inventing a
        // fake assignment.
#pragma warning disable CS0649 // field is never assigned to in this compilation unit
        private IChannelPublisher? _processorsPublisher;

        // Interactive terminal-over-Uplink: the kos.terminal.<coreId> screen
        // downlink + single-owner keystroke/resize/open/close commands that
        // replace the standalone telnet proxy. Null until Register wires them.
#pragma warning disable CS0169 // field is never read in this compilation unit (RegisterKspBindings is the only reader)
        private IDynamicChannelSource? _terminalSource;
#pragma warning restore CS0169
        private KosTerminalManager? _terminalManager;
#pragma warning restore CS0649

        // kos.run — general-purpose "type this command line, correlate the
        // resulting [KOSDATA]/[KOSERROR] block back" RPC that replaces the
        // standalone telnet proxy's ad-hoc executeScript path (see
        // kos-uplink-full-migration.md). _runManager is pure bookkeeping,
        // constructed unconditionally (mirrors _accumulator) so headless
        // tests can wire a recording publisher via WireRunForTests without
        // needing KosExtension.Register at all. _runSource (the actual wire
        // publisher) is assigned only in RegisterKspBindings — same
        // "assigned in the other half" story as _terminalSource above.
        private readonly KosRunManager _runManager = new KosRunManager();
#pragma warning disable CS0169 // field is never read in this compilation unit (RegisterKspBindings is the only reader)
        private IDynamicChannelSource? _runSource;
#pragma warning restore CS0169

        // Subscription short-circuit for OnPrint (adversarial-review I1): true
        // iff at least one kos.compute.* topic currently has a subscriber. Wired
        // to the host's subscription mirror in Register; null (→ treated as "no
        // gate") only in headless tests that don't call Register.
        private Func<bool>? _computeSubscribed;

        // Reverse-map from a ScreenBuffer to the owning CPU's KOSCoreId,
        // resolved ONLY when a [KOSDATA] block completes (never per fragment).
        // Injectable so headless tests can count invocations and avoid the live
        // kOSProcessor.AllInstances() call. Defaults to a KSP-free placeholder;
        // InstallProductionDefaults() swaps in the real reverse-map for a
        // production instance (see KosExtension.Ksp.cs).
        internal Func<object, int> CoreIdResolver { get; set; } = _ => -1;

        // Error sink for the command main-thread path. Kept as a delegate (not
        // a direct UnityEngine.Debug call) so the KSP-free half of this class
        // never references UnityEngine at compile time. Defaults to a no-op;
        // InstallProductionDefaults() swaps in Debug.LogError for a production
        // instance.
        private Action<string> _logError = _ => { };

        public MainThreadDispatcher Dispatcher { get; }

        public KosExtension() : this(null, null)
        {
        }

        internal KosExtension(MainThreadDispatcher? dispatcher, Action<MainThreadDispatcher>? bindDispatcherAddon)
        {
            // Only the true default path (the public parameterless ctor,
            // i.e. real production construction) picks up the real kOS/Unity
            // wiring. A caller that supplies either argument explicitly (every
            // headless test) keeps exactly what it passed — same contract as
            // the original single-file `?? BindRealAddon` / `?? ResolveCoreId`
            // defaults, just relocated behind InstallProductionDefaults() so
            // this constructor itself stays KSP-free.
            bool useProductionDefaults = dispatcher == null && bindDispatcherAddon == null;

            Dispatcher = dispatcher ?? new MainThreadDispatcher(
                ex => _logError("[Gonogo.KosUplink] dispatched action threw: " + ex));
            _bindDispatcherAddon = bindDispatcherAddon ?? (_ => { });

            if (useProductionDefaults)
            {
                InstallProductionDefaults();
            }
        }

        /// <summary>
        /// KSP-touching production wiring seam. Implemented in
        /// <c>KosExtension.Ksp.cs</c> (installs the real Debug.LogError sink,
        /// the real GameObject/addon binder, and the real
        /// <c>kOSProcessor</c>-reverse-map <see cref="CoreIdResolver"/>) —
        /// that file is excluded from the headless test build, so there this
        /// partial method has no implementing declaration and every call
        /// below compiles away to nothing (standard C# optional-partial-method
        /// behaviour), leaving the KSP-free placeholders in place.
        /// </summary>
        partial void InstallProductionDefaults();

        /// <summary>
        /// <see cref="ISitrepUplink.Register"/>. The interface member itself
        /// must exist in this KSP-free half — <c>UplinkDiscovery</c>'s
        /// reflection scan (exercised headlessly by
        /// <c>KosExtensionDiscoveryTests</c>) requires a fully-implemented
        /// <see cref="ISitrepUplink"/> even though it never calls
        /// <see cref="Register"/> — so it forwards, unconditionally, to
        /// <see cref="RegisterKspBindings"/>: the real kOS/Unity wiring in
        /// <c>KosExtension.Ksp.cs</c>, a silent no-op here when that file
        /// isn't part of the compilation (the headless test build).
        /// </summary>
        public void Register(IUplinkHost host)
        {
            RegisterKspBindings(host);
        }

        /// <summary>The kOS/Unity-touching body of <see cref="Register"/> — see <c>KosExtension.Ksp.cs</c>.</summary>
        partial void RegisterKspBindings(IUplinkHost host);

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
                // Interactive terminal uplink — keystrokes/open/close ride
                // gonogo's SignalDelay to the craft (genuine remote input; the
                // lease-token + idle guards are re-checked at delivery on the
                // main thread).
                new CommandDeclaration { Command = KosChannels.TerminalOpenCommand, Delayed = true },
                new CommandDeclaration { Command = KosChannels.KeystrokeCommand, Delayed = true },
                // Resize is NOT delayed: the render width must match between the
                // mod's cursor-addressed screen diff and xterm on the client. A
                // delayed resize leaves the mod diffing at a stale width for a
                // full light-time round-trip, so the client renders those diffs
                // at the wrong column and the terminal reads as garbled until it
                // converges. Viewport size is a local display concern, distinct
                // from a keystroke — apply it immediately so the two sides agree.
                new CommandDeclaration { Command = KosChannels.TerminalResizeCommand, Delayed = false },
                new CommandDeclaration { Command = KosChannels.TerminalCloseCommand, Delayed = true },
                // kos.run — general-purpose ad-hoc RPC (replaces telnet
                // executeScript). DELAYED, single-in-flight-per-CPU: a second
                // kos.run for a CPU that already has one in flight is
                // rejected (KosRunManager.TryArm), mirroring the idle-prompt
                // guard every other CPU-targeted command re-checks at
                // delivery on the main thread.
                new CommandDeclaration { Command = KosChannels.RunCommand, Delayed = true },
            },
        };

        // ----------------------------------------------------------------
        // Interactive terminal commands — dispatched on the Courier thread,
        // marshalled to the KSP main thread (same drop-not-run discipline as
        // Exec). The KosTerminalManager holds the lease + screen state; every
        // call here runs on the main thread so no locking is needed. None of
        // this touches kOS/Unity types directly (KosTerminalManager doesn't
        // either) — it's all KSP-free.
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
        /// directly, bypassing <see cref="KosExtension.Register"/> (which needs a
        /// live kOS/Unity process for the version guard + Harmony install). Pair
        /// with <see cref="CoreIdResolver"/> to exercise <see cref="OnPrint"/>
        /// headlessly.
        /// </summary>
        internal void WireComputeForTests(IDynamicChannelSource computeSource, Func<bool>? computeSubscribed)
        {
            _computeSource = computeSource;
            _computeSubscribed = computeSubscribed;
        }

        /// <summary>
        /// Test-only: arm a <c>kos.run</c> request and/or wire a recording
        /// publisher directly against <see cref="_runManager"/>, bypassing the
        /// KSP-touching <c>Run</c> command handler (<c>KosExtension.Ksp.cs</c>)
        /// entirely — that handler's own guard (idle-prompt check, kOS type
        /// access) can't run headlessly. Pair with <see cref="OnPrint"/> to
        /// exercise the block-routing / gate-widening behaviour end to end.
        /// </summary>
        internal void WireRunForTests(Action<int, KosRunResult> publish)
        {
            _runManager.SetPublisher(publish);
        }

        /// <summary>Test-only: arm a run directly, bypassing the KSP-touching Run command handler.</summary>
        internal bool ArmRunForTests(int coreId, string requestId) => _runManager.TryArm(coreId, requestId);

        // ----------------------------------------------------------------
        // kos.processors
        // ----------------------------------------------------------------

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
            // Only CaptureProcessors (KosExtension.Ksp.cs) constructs one of
            // these with a real Ut — the headless test build never calls it,
            // hence the compiler-visible "never assigned" warning here.
#pragma warning disable CS0649
            public double Ut;
#pragma warning restore CS0649
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
        /// when at least one <c>[KOSDATA]</c>/<c>[KOSERROR]</c> block has
        /// completed and is about to publish (spec §4.2), stamps it onto the
        /// completed blocks, and — for each block — either hands it to
        /// <see cref="_runManager"/> (a <c>kos.run</c> is armed for that CPU:
        /// the block IS that call's correlated result, not a compute sample)
        /// or publishes each field to
        /// <c>kos.compute.&lt;topic&gt;.&lt;field&gt;</c> (the ordinary
        /// centralised-feed / <c>kos.exec</c> path).</item>
        /// </list>
        /// Must be cheap and non-blocking (it is inside PRINT). Entirely
        /// KSP-free — <paramref name="screen"/> is an opaque <see cref="object"/>
        /// handle, never touched as a real kOS type here.
        /// </summary>
        internal void OnPrint(object screen, string text)
        {
            if (_computeSource == null || screen == null || string.IsNullOrEmpty(text))
            {
                return;
            }

            // I1: burn nothing while no client is looking — WIDENED to also stay
            // open while any kos.run is in flight (on ANY CPU): a kos.run caller
            // never subscribes to kos.compute.*, so without this a run armed on
            // a CPU with no compute subscriber would starve here and its
            // promise would hang forever (see kos-uplink-full-migration.md's
            // "Subscription-gate fix"). Overhead is bounded to a run's
            // lifetime — typically well under a second.
            if (_computeSubscribed != null && !_computeSubscribed() && !_runManager.HasAnyArmed())
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
                if (_runManager.IsArmed(coreId))
                {
                    // This CPU has an in-flight kos.run — the completed block
                    // (data OR explicit error) IS that call's result, consumed
                    // here rather than fanned to kos.compute.*. A CPU's
                    // interpreter runs one command at a time, so there is no
                    // ambiguity about which in-flight call produced this block.
                    _runManager.Complete(coreId, block);
                    continue;
                }
                foreach (var kv in block.Fields)
                {
                    var sub = KosChannels.ComputeFieldSubTopic(block.Topic, kv.Key);
                    _computeSource.Publisher(sub).Publish(kv.Value, 0.0);
                }
            }
        }

        // ----------------------------------------------------------------
        // Commands — dispatched on the Courier thread, marshalled to main
        // ----------------------------------------------------------------

        /// <summary>Bounded wait for a main-thread kOS call to complete before the Courier gives up (F2 backstop analogue). Instance field so headless tests can shorten it.</summary>
        internal TimeSpan CommandMainThreadTimeout { get; set; } = TimeSpan.FromSeconds(5);

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
            // Reentrancy guard (kos-uplink-gap self-deadlock). In production the
            // ChannelEngine is built executeCommandsOnMainThread:true, so it has
            // ALREADY marshalled this command handler onto the KSP main thread
            // (drained by GonogoAddon.Update -> ChannelEngine.RunPendingCommands)
            // before the handler body runs. Dispatcher.Drain runs on that SAME
            // Unity main thread (KosMainThreadDispatcherAddon.Update). So when we
            // reach here we are frequently ALREADY on the dispatcher's drain
            // thread — and Dispatch-and-block would park that thread inside
            // Done.Wait, where it can never reach the Drain that would run
            // `work`. The whole main thread wedges; the engine's own 4s backstop
            // fires first and the client sees CommandErrorCode.Timeout while the
            // kOS side effect (TypeCommand/RUNPATH) is abandoned and never runs —
            // exactly the live kos.run failure. When already on the drain thread,
            // run inline: no second hop, no block, no deadlock. The Courier-thread
            // / headless path (Dispatch + bounded wait below) is unchanged.
            if (Dispatcher.IsOnDrainThread)
            {
                try
                {
                    return work();
                }
                catch (Exception ex)
                {
                    _logError("[Gonogo.KosUplink] command main-thread work threw: " + ex);
                    return CommandResult.Fail(CommandErrorCode.Unknown);
                }
            }

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
                    _logError("[Gonogo.KosUplink] command main-thread work threw: " + ex);
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
    }
}
