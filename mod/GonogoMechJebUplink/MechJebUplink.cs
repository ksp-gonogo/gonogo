// GonogoMechJebUplink: GPLv3. See GonogoMechJebUplink.csproj's header comment
// for the licence/linkage rationale.

using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("GonogoMechJebUplink.Tests")]

namespace Gonogo.MechJebUplink
{
    /// <summary>
    /// The MechJeb2 remote-autopilot bridge Uplink (see
    /// <c>local_docs/design/mechjeb-uplink-sketch.md</c> and
    /// <c>local_docs/design/mechjeb-decompile-lock.md</c>). COMMAND-ONLY: it
    /// exposes exactly the three commands the pre-existing MechJeb client
    /// widget already dispatches (<c>mechjeb.engageAscentAutopilot</c>,
    /// <c>mechjeb.executeNextNode</c>, <c>mechjeb.landAtTarget</c>). No
    /// channels: MechJeb readouts are derivable client-side (see the
    /// widget's own doc comment), so this Uplink declares
    /// <c>Manifest.Channels</c> empty, mirroring <c>Gonogo.KSP.FlightOpsUplink</c>'s
    /// command-only shape.
    ///
    /// <para><b>Every MechJeb2 call runs on the KSP main thread</b>: the
    /// active-vessel/computer-module reads and the <c>Users.Add</c>/
    /// <c>ExecuteOneNode</c>/<c>LandAtPositionTarget</c> writes all touch
    /// Unity/KSP state, so every command handler is wrapped in
    /// <see cref="RunOnMainThread"/> (bounded timeout, drop-not-run on
    /// timeout so a delayed command can never double-fire): copied from
    /// <c>GonogoKosUplink.KosExtension.RunOnMainThread</c>'s exact discipline.</para>
    ///
    /// <para><b>Live-KSP validation pending.</b> The MechJeb2-touching engage
    /// path (<c>MechJebController.cs</c>) compiles against the linked
    /// MechJeb2 assembly but the <c>Users.Add</c> handshake + the settings
    /// write cannot be exercised without a running KSP+MechJeb2 flight
    /// scene; the pure logic (version guard, main-thread marshalling, the
    /// inert-when-absent path) is fully headlessly tested, see
    /// <c>GonogoMechJebUplink.Tests</c>.</para>
    ///
    /// <para><b>File split:</b> this file is the KSP/Unity/MechJeb2-FREE
    /// half, everything <c>GonogoMechJebUplink.Tests</c> Compile-Includes
    /// directly (mirrors <c>GonogoKosUplink</c>/<c>GonogoKosUplink.Tests</c>'s
    /// pure-logic split). The MechJeb2/Unity-touching half (<c>Register</c>,
    /// the actual engage calls in <c>MechJebController.cs</c>, the real
    /// Debug.LogError/GameObject wiring) lives in
    /// <c>MechJebUplink.Ksp.cs</c>, which the test project deliberately does
    /// NOT compile: a headless build has no MechJeb2.dll/UnityEngine.dll
    /// reference assemblies to link against. The two halves meet at
    /// <see cref="InstallProductionDefaults"/>, a partial method: implemented
    /// (real MechJeb2/Unity wiring) in the production assembly, silently a
    /// no-op when the implementing file isn't part of the compilation (the
    /// test build).</para>
    /// </summary>
    [SitrepUplink("mechjeb")]
    public sealed partial class MechJebUplink : ISitrepUplink
    {
        // Bound in InstallProductionDefaults() (MechJebUplink.Ksp.cs) for a
        // production instance; a caller-supplied value (e.g. a test) is left
        // untouched, see the ctor's useProductionDefaults gate below.
        private Action<MainThreadDispatcher> _bindDispatcherAddon;

        // Set at Register when the MechJeb2 version-guard fails (the uplink
        // goes inert); read by Health() on the Courier thread. Null ==
        // available. The guard probe runs at Register only, so Health()
        // reads this cached result rather than a live (main-thread-only)
        // MechJeb2 read. Volatile: Register runs on the main thread, Health()
        // is polled on the Courier thread.
        //
        // Assigned only in RegisterMechJebBindings (MechJebUplink.Ksp.cs):
        // the headless test build never calls Register, so the compiler
        // can't see an assignment in THIS half and warns. Harmless;
        // suppressed rather than worked around, mirroring
        // GonogoKosUplink.KosExtension's identical pattern. Internal (not
        // private) so GonogoMechJebUplink.Tests can drive Health() into its
        // Unavailable state directly, without needing the MechJeb2-touching
        // Register path (excluded from the headless test build).
#pragma warning disable CS0649 // field is never assigned to in this compilation unit
        internal volatile string? _unavailableReason;
#pragma warning restore CS0649

        // Error sink for the command main-thread path. Kept as a delegate
        // (not a direct UnityEngine.Debug call) so this KSP-free half never
        // references UnityEngine at compile time. Defaults to a no-op;
        // InstallProductionDefaults() swaps in Debug.LogError for a
        // production instance.
        private Action<string> _logError = _ => { };

        public MainThreadDispatcher Dispatcher { get; }

        public MechJebUplink() : this(null, null)
        {
        }

        internal MechJebUplink(MainThreadDispatcher? dispatcher, Action<MainThreadDispatcher>? bindDispatcherAddon)
        {
            // Only the true default path (the public parameterless ctor, i.e.
            // real production construction) picks up the real MechJeb2/Unity
            // wiring. A caller that supplies either argument explicitly
            // (every headless test) keeps exactly what it passed.
            bool useProductionDefaults = dispatcher == null && bindDispatcherAddon == null;

            Dispatcher = dispatcher ?? new MainThreadDispatcher(
                ex => _logError("[Gonogo.MechJebUplink] dispatched action threw: " + ex));
            _bindDispatcherAddon = bindDispatcherAddon ?? (_ => { });

            if (useProductionDefaults)
            {
                InstallProductionDefaults();
            }
        }

        /// <summary>
        /// KSP-touching production wiring seam. Implemented in
        /// <c>MechJebUplink.Ksp.cs</c> (installs the real Debug.LogError sink
        /// + the real GameObject/addon binder): that file is excluded from
        /// the headless test build, so there this partial method has no
        /// implementing declaration and every call below compiles away to
        /// nothing (standard C# optional-partial-method behaviour).
        /// </summary>
        partial void InstallProductionDefaults();

        /// <summary>
        /// <see cref="ISitrepUplink.Register"/>. The interface member itself
        /// must exist in this KSP-free half (<c>UplinkDiscovery</c>'s
        /// reflection scan requires a fully-implemented <see cref="ISitrepUplink"/>
        /// even though a headless test never calls <see cref="Register"/>):
        /// forwards, unconditionally, to <see cref="RegisterMechJebBindings"/>,
        /// the real MechJeb2/Unity wiring in <c>MechJebUplink.Ksp.cs</c>, a
        /// silent no-op here when that file isn't part of the compilation.
        /// </summary>
        public void Register(IUplinkHost host)
        {
            RegisterMechJebBindings(host);
        }

        /// <summary>The MechJeb2/Unity-touching body of <see cref="Register"/>: see <c>MechJebUplink.Ksp.cs</c>.</summary>
        partial void RegisterMechJebBindings(IUplinkHost host);

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "mechjeb",
            Version = "0.1.0",
            // Null when the generated const is empty (dev / never-released) so
            // the loader degrades to the two-way check; a real sha256-... once
            // the release build bakes it (mod/scripts/bake-client-hash.mjs ->
            // ExpectedClientHash.g.cs).
            ExpectedClientHash = string.IsNullOrEmpty(ExpectedClientHash.Value) ? null : ExpectedClientHash.Value,
            // Command-only: see the class doc comment. MechJeb readouts are
            // derivable client-side, so there is nothing to publish.
            Channels = new List<ChannelDeclaration>(),
            Commands = new List<CommandDeclaration>
            {
                // All three are Delayed: engaging a remote autopilot is a
                // genuine signal to the craft, rides the Courier's light-time
                // delay exactly like every other vessel-actuation command
                // (mirrors VesselUplink's classification, NOT FlightOpsUplink's
                // game-level delayed:false commands).
                new CommandDeclaration { Command = MechJebChannels.EngageAscentAutopilotCommand, Delayed = true },
                new CommandDeclaration { Command = MechJebChannels.ExecuteNextNodeCommand, Delayed = true },
                new CommandDeclaration { Command = MechJebChannels.LandAtTargetCommand, Delayed = true },
            },
        };

        /// <summary>
        /// Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>):
        /// Unavailable with the version-guard reason when MechJeb2 is absent
        /// or its API drifted (the uplink went inert at Register), else
        /// Healthy. Courier-thread cheap: reads a cached field, never a live
        /// main-thread MechJeb2 read.
        /// </summary>
        public UplinkHealth Health() =>
            _unavailableReason != null
                ? new UplinkHealth(UplinkHealthState.Unavailable, _unavailableReason)
                : UplinkHealth.Healthy;

        // ----------------------------------------------------------------
        // Commands: dispatched on the Courier thread, marshalled to main.
        // Copied from GonogoKosUplink.KosExtension.RunOnMainThread verbatim
        // (see that method's doc comment for the full drop-not-run-on-timeout
        // rationale); MechJeb2 has the identical "a delayed command's side
        // effect must never fire after the client was told Timeout" hazard.
        // ----------------------------------------------------------------

        /// <summary>Bounded wait for a main-thread MechJeb2 call to complete before the Courier gives up. Instance field so headless tests can shorten it.</summary>
        internal TimeSpan CommandMainThreadTimeout { get; set; } = TimeSpan.FromSeconds(5);

        /// <summary>
        /// Marshals <paramref name="work"/> onto the main-thread dispatcher
        /// and blocks the Courier thread until it completes or
        /// <see cref="CommandMainThreadTimeout"/> elapses (returning
        /// <see cref="CommandErrorCode.Timeout"/>). Any exception from
        /// <paramref name="work"/> becomes a typed <c>Unknown</c> failure: a
        /// command must always return a structured result, never throw.
        ///
        /// <para><b>Timeout is drop-not-run</b> (mirrors
        /// <c>GonogoKosUplink.KosExtension.RunOnMainThread</c>'s M1 fix): the
        /// waiter marks the job <see cref="MainThreadJob.Abandoned"/> on
        /// timeout and does NOT dispose the handle; the dispatcher then DROPS
        /// an abandoned job (never runs <paramref name="work"/>) and disposes
        /// the handle itself. Exactly one side disposes, and no
        /// <c>Set()</c> ever lands on a disposed handle. This is what
        /// guarantees an ascent-engage / node-execute / land command can
        /// never double-fire against the vessel after the client has already
        /// been told it timed out.</para>
        /// </summary>
        internal CommandResult RunOnMainThread(Func<CommandResult> work)
        {
            // Reentrancy guard: production's ChannelEngine is built
            // executeCommandsOnMainThread:true, so a command handler is
            // frequently ALREADY running on the KSP main thread by the time
            // this runs. When we are already on Dispatcher's own drain
            // thread, run inline: no second hop, no block, no deadlock
            // (mirrors the kOS Uplink's identical reentrancy fix).
            if (Dispatcher.IsOnDrainThread)
            {
                try
                {
                    return work();
                }
                catch (Exception ex)
                {
                    _logError("[Gonogo.MechJebUplink] command main-thread work threw: " + ex);
                    return CommandResult.Fail(CommandErrorCode.Unknown);
                }
            }

            var job = new MainThreadJob();
            Dispatcher.Dispatch(() =>
            {
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
                    _logError("[Gonogo.MechJebUplink] command main-thread work threw: " + ex);
                    job.Result = CommandResult.Fail(CommandErrorCode.Unknown);
                }
                finally
                {
                    job.Done.Set();
                    if (job.Abandoned)
                    {
                        job.Done.Dispose();
                    }
                }
            });

            if (!job.Done.Wait(CommandMainThreadTimeout))
            {
                job.Abandoned = true;
                return CommandResult.Fail(CommandErrorCode.Timeout);
            }

            try
            {
                return job.Result ?? CommandResult.Fail(CommandErrorCode.Unknown);
            }
            finally
            {
                job.Done.Dispose();
            }
        }

        /// <summary>
        /// One <see cref="RunOnMainThread"/> marshaled call. Mirrors
        /// <c>GonogoKosUplink.KosExtension.MainThreadJob</c>: the
        /// <see cref="Abandoned"/> flag is the sole signal that routes both
        /// "drop the work" and "who disposes <see cref="Done"/>" between the
        /// waiter and the dispatcher, so the handle is disposed exactly once
        /// and never <c>Set()</c>-after-dispose.
        /// </summary>
        private sealed class MainThreadJob
        {
            public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);
            public volatile bool Abandoned;
            public CommandResult? Result;
        }
    }
}
