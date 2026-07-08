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

        public MainThreadDispatcher Dispatcher { get; }

        public KosExtension() : this(null, null)
        {
        }

        internal KosExtension(MainThreadDispatcher? dispatcher, Action<MainThreadDispatcher>? bindDispatcherAddon)
        {
            Dispatcher = dispatcher ?? new MainThreadDispatcher(
                ex => Debug.LogError("[Gonogo.Kos] dispatched action threw: " + ex));
            _bindDispatcherAddon = bindDispatcherAddon ?? BindRealAddon;
        }

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
                // P2: kos.file. P3: kos.terminal.<sessionId> (reliable-ordered),
                // kos.terminal.open/close/resize, kos.keystroke.
            },
            Commands = new List<CommandDeclaration>
            {
                // RUNPATH trigger — DELAYED, single-owner (spec §3.0 flag is
                // P3; P1 couriers normally). Reachability + idle-prompt guard
                // are re-checked at delivery, on the main thread.
                new CommandDeclaration { Command = KosChannels.ExecCommand, Delayed = true },
                new CommandDeclaration { Command = KosChannels.DispatchNowCommand, Delayed = true },
                new CommandDeclaration { Command = KosChannels.ReEnableCommand, Delayed = true },
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
            return list;
        }

        /// <summary>COURIER-THREAD handle: publish the captured list. Touches no kOS API.</summary>
        internal void HandleProcessors(object? captured)
        {
            if (captured is List<KosProcessorInfo> list)
            {
                _processorsPublisher?.Publish(list, 0.0);
            }
        }

        // ----------------------------------------------------------------
        // kos.compute — the Print-postfix capture path (main thread)
        // ----------------------------------------------------------------

        /// <summary>
        /// The <see cref="KosComputeHarmony.Sink"/> — runs on the KSP main
        /// thread synchronously inside kOS's <c>PRINT</c>. Reverse-resolves the
        /// emitting CPU (spec §4.2), accumulates the fragment, and publishes
        /// every completed <c>[KOSDATA]</c> block's fields to
        /// <c>kos.compute.&lt;topic&gt;.&lt;field&gt;</c>. Must be cheap and
        /// non-blocking (it is inside PRINT).
        /// </summary>
        private void OnPrint(object screen, string text)
        {
            if (_computeSource == null || string.IsNullOrEmpty(text))
            {
                return;
            }

            int coreId = ResolveCoreId(screen);
            if (coreId < 0)
            {
                return;
            }

            foreach (var block in _accumulator.Append(coreId, text))
            {
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
        /// script PRINT, but fail-soft).
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

        /// <summary>Bounded wait for a main-thread kOS call to complete before the Courier gives up (F2 backstop analogue).</summary>
        private static readonly TimeSpan CommandMainThreadTimeout = TimeSpan.FromSeconds(5);

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
        /// </summary>
        private CommandResult RunOnMainThread(Func<CommandResult> work)
        {
            CommandResult? result = null;
            using var done = new ManualResetEventSlim(false);
            Dispatcher.Dispatch(() =>
            {
                try
                {
                    result = work();
                }
                catch (Exception ex)
                {
                    Debug.LogError("[Gonogo.Kos] command main-thread work threw: " + ex);
                    result = CommandResult.Fail(CommandErrorCode.Unknown);
                }
                finally
                {
                    done.Set();
                }
            });

            if (!done.Wait(CommandMainThreadTimeout))
            {
                return CommandResult.Fail(CommandErrorCode.Timeout);
            }
            return result ?? CommandResult.Fail(CommandErrorCode.Unknown);
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
