using System;
using System.Collections.Generic;
using Gonogo.KSP.CommandCentres;
using Gonogo.KSP.SilenceTracking;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Sitrep.Host.Comms;

namespace Gonogo.KSP
{
    /// <summary>
    /// The bundled CORE comms registration (comms-uplink-design.md §2.2, §6):
    /// it OWNS the exclusive <c>"comms"</c> capability (registering
    /// <see cref="CommNetBackend"/> as the always-present vanilla factory),
    /// declares the four shared always-present channels + <c>comms.network</c>
    /// + the core <c>comms.delay</c> channel ONCE, and sources them from
    /// whichever backend the election picked: resolved at capture time via
    /// <c>host.Kernel.Query&lt;ICommsBackend&gt;("comms")</c>. Neither CommNet
    /// nor RealAntennas declares these channels itself; that is the
    /// shared-namespace-single-declaration rule (§5).
    ///
    /// <para>The elected backend reads live KSP, so every read happens in the
    /// capture-on-main sampler (<see cref="CaptureOnMain"/>): the same F1 seam
    /// GonogoScansatUplink uses. The Courier-side handle
    /// (<see cref="HandleOnCourier"/>) only publishes the plain captured
    /// payloads. <c>comms.delay</c> is computed by the CORE
    /// <see cref="SignalDelay"/> math from the captured hop geometry, gonogo's
    /// own light-time computation, not a backend accessor (§3.1).</para>
    ///
    /// <para><b>Health:</b> implements <see cref="ISitrepUplink.Health"/>:
    /// the second real implementation after
    /// <c>Gonogo.KerbcastUplink.KerbcastUplink</c>, and "zero new plumbing":
    /// <see cref="Health"/> reuses the exact same <see cref="CommsElection.Elected"/>
    /// read <see cref="ComputeConnectedOnMain"/>/<see cref="ComputeDelayOnMain"/>/
    /// <see cref="CaptureOnMain"/> already perform. The state machine itself is
    /// <see cref="CommsHealth"/>: a pure function, headless-tested in
    /// <c>Sitrep.Host.Tests</c> (see that type's doc comment for why it lives
    /// in <c>Sitrep.Host.Comms</c> rather than here).</para>
    /// </summary>
    [SitrepUplink("comms")]
    public sealed class CommsCoreUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        public const string ConnectivityTopic = "comms.connectivity";
        public const string SignalStrengthTopic = "comms.signalStrength";
        public const string ControlStateTopic = "comms.controlState";
        public const string PathTopic = "comms.path";
        public const string NetworkTopic = "comms.network";
        public const string DelayTopic = "comms.delay";

        /// <summary>
        /// The elected backend's DECLARED occlusion geometry, resolved per body
        /// (see <see cref="Sitrep.Contract.CommsOcclusion"/>). Sourced the same
        /// way as every other shared channel here: from whichever backend the
        /// election picked, so a consumer asking "what radius of this body
        /// blocks a radio path" never has to know whether RealAntennas is
        /// installed.
        /// </summary>
        public const string OcclusionTopic = "comms.occlusion";

        /// <summary>
        /// The client-facing connectivity MetaTopic (comms-delay-model-
        /// consistency spec): a Delayed channel the engine special-cases as
        /// freeze-EXEMPT (see <see cref="Sitrep.Host.ChannelEngine.ConnectivityMetaTopic"/>,
        /// which this literal must match, and <see cref="Sitrep.Contract.CommsLink"/>).
        /// It carries the same link up/down the TrueNow <c>comms.connectivity</c>
        /// observation channel does, but Delayed + freeze-exempt so the
        /// DISCONNECT EDGE escapes the reveal-gate freeze and reaches the client
        /// (revealed at the last-known light-time horizon), where a plain
        /// Delayed channel would freeze at last-known and the client's
        /// "NO SIGNAL" could never fire. Sourced from the SAME
        /// <see cref="CaptureOnMain"/> connectivity read that drives the freeze
        /// gate, so the client-visible link state and the gate can never
        /// disagree. This is the connectivity channel clients SHOULD read
        /// (via the <c>comm.connected</c> mapped key / <c>comms.link.connected</c>).
        /// </summary>
        public const string LinkTopic = "comms.link";

        /// <summary>
        /// The fleet-wide silence roster (<see cref="Sitrep.Contract.FleetSilence"/>),
        /// published by <see cref="SilenceTracking.FleetSilenceChannels"/> from the
        /// same tracker tick that feeds the per-vessel <c>silence.&lt;guid&gt;.state</c>
        /// topics. Comms-owned for the same reason those are: it is a model's
        /// reckoning, not a fact stock KSP hands you.
        ///
        /// <para>A STATIC topic on the main node, unlike its per-vessel siblings,
        /// which is the entire point of it: a consumer that has to work the fleet
        /// out for itself cannot name a per-guid topic. See
        /// <see cref="Sitrep.Contract.FleetSilence"/>'s own doc comment for what
        /// that costs (the main node's delay rather than each vessel's own) and
        /// why the per-vessel topics stay authoritative.</para>
        /// </summary>
        public const string FleetSilenceTopic = "fleet.silence";

        /// <summary>
        /// The <c>comms.commandCentre</c> topic:
        /// identifies which command centre the active vessel's <c>ControlPath</c>
        /// currently terminates at, KSC or a crewed control-source vessel, reusing
        /// the SAME id/name/kind scheme <c>commandCentre.roster</c> uses. TrueNow
        /// for the same reason the rest of this family is: it describes the active
        /// vessel's OWN link (which node its own comms.path already names raw),
        /// not a fact about some OTHER vessel's state.
        /// </summary>
        public const string CommandCentreTopic = "comms.commandCentre";

        /// <summary>
        /// Apply signal delay during a SIMULATION, or cut it. The console's
        /// only way to change a policy the mod enforces; see
        /// <see cref="SimulationDelayPolicy"/> for what it decides.
        /// </summary>
        public const string SetSimulationDelayPolicyCommand = "comms.setSimulationDelayPolicy";

        // The config flag lives in core (§3). Default OFF for in-place upgraders;
        // the intended forward default is ON at real light-speed (§3.1), that
        // literal is a config/onboarding decision, so core ships it off and the
        // config layer flips it. Held here so a future config read can set it
        // before Register wires the delay source.
        private static SignalDelayConfig _signalDelayConfig = SignalDelayConfig.Off();

        /// <summary>Set the SignalDelay config (called by the config layer before registration).</summary>
        public static void ConfigureSignalDelay(SignalDelayConfig config) =>
            _signalDelayConfig = config ?? SignalDelayConfig.Off();

        // The kernel, held statically alongside the config because the delay
        // policy is a STATIC read: five separate readers reach
        // SignalDelayConfig below without an instance of this uplink in hand,
        // and the simulation backend that can cut the delay is elected on the
        // kernel. Set from Register, the same place the instance field is.
        private static Kernel? _policyKernel;

        /// <summary>
        /// Point the delay policy at a kernel. Called from
        /// <see cref="Register"/> with the host's own; the parameter exists so a
        /// test can drive the policy without a live engine, and can put it back.
        /// </summary>
        internal static void ConfigureSimulationKernel(Kernel? kernel) => _policyKernel = kernel;

        /// <summary>
        /// The signal-delay config in force, so every delay reader (the reveal
        /// gate, comms.delay, fleet light-time, the command-centre pass and the
        /// currency deadline) uses one answer.
        ///
        /// <para>EFFECTIVE, not authored: a simulation cuts the delay unless the
        /// operator asked otherwise, and deriving it here is what makes every
        /// one of those readers cut together rather than leaving a board whose
        /// telemetry is live and whose money still arrives late. See
        /// <see cref="SimulationDelayPolicy"/>.</para>
        /// </summary>
        internal static SignalDelayConfig SignalDelayConfig =>
            SimulationDelayPolicy.Effective(
                _signalDelayConfig,
                SimulationElection.Elected(_policyKernel));

        /// <summary>The config as AUTHORED, before a simulation could have cut it: what the settings row reports and the command below writes.</summary>
        internal static SignalDelayConfig AuthoredSignalDelayConfig => _signalDelayConfig;

        // Held the same way as _signalDelayConfig above: Plan 3's command-centre
        // registry (GonogoAddon.cs builds it after uplink discovery, alongside the
        // stock-home-node + crewed-vessel sources) so comms.commandCentre resolves
        // the ACTIVE vessel's terminal node against the SAME live centres
        // commandCentre.roster does, rather than constructing throwaway sources
        // (and re-paying their FindObjectsOfType/vessel-scan cost) every comms
        // capture tick.
        private static CommandCentreRegistry? _commandCentreRegistry;

        /// <summary>Set the shared command-centre registry (called by GonogoAddon once Plan 3's registry is built).</summary>
        public static void ConfigureCommandCentreRegistry(CommandCentreRegistry registry) =>
            _commandCentreRegistry = registry;

        private IChannelPublisher? _connectivity;
        private IChannelPublisher? _signalStrength;
        private IChannelPublisher? _controlState;
        private IChannelPublisher? _path;
        private IChannelPublisher? _network;
        private IChannelPublisher? _delay;
        private IChannelPublisher? _link;
        private IChannelPublisher? _occlusion;
        private IChannelPublisher? _commandCentre;

        private Kernel? _kernel;

        // The occlusion declaration is effectively static within a session (the
        // body set never changes; the stock multipliers change only if the player
        // edits the difficulty settings), so an unchanged one republishes the
        // SAME instance. ChannelEmitter's change-gate compares by equality, and a
        // wire POCO has none, so identity is what buys the suppression: holding
        // the instance costs a keyframe every 30 UT and nothing in between, where
        // a fresh-but-identical object each tick would push a full body list at
        // sample cadence. Late subscribers still get an immediate keyframe
        // (ChannelEmitter.NotifySubscribed), so the suppression is invisible.
        private CommsOcclusion? _lastOcclusion;

        private static ChannelDeclaration TrueNow(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            // Every comms.* channel is TRUE-NOW: ground-side facts about the
            // link as KSC sees it, and comms.delay is the value that DRIVES
            // the delay of everything else so it is never itself delayed (§1).
            Delay = DelayRole.TrueNow,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "comms",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                TrueNow(ConnectivityTopic),
                TrueNow(SignalStrengthTopic),
                TrueNow(ControlStateTopic),
                TrueNow(PathTopic),
                TrueNow(NetworkTopic),
                TrueNow(DelayTopic),
                // comms.occlusion is TrueNow for a stronger reason than its
                // siblings: it is not an observation of the vessel at all but a
                // statement about the universe's geometry and the rule the
                // elected backend applies to it. A delayed model would have a
                // predictor computing tomorrow's blackout from yesterday's
                // assumptions.
                TrueNow(OcclusionTopic),
                // comms.link: Delayed (rides the normal light-time horizon) but
                // the ENGINE special-cases it as freeze-EXEMPT by topic identity
                // (ChannelEngine.ConnectivityMetaTopic), matching how comms.delay
                // is special-cased as always-live. Declared Delayed here for
                // accuracy even though the exemption itself is topic-identity-
                // keyed, not a read of this Delay disposition.
                new ChannelDeclaration
                {
                    Topic = LinkTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = FleetSilenceTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                TrueNow(CommandCentreTopic),
            },
            Commands = new List<CommandDeclaration>
            {
                // Ground infrastructure, not a signal to a craft: a preference
                // about delay that itself rode the delay would be unusable at
                // exactly the moment an operator wanted to change it.
                new CommandDeclaration
                {
                    Command = SetSimulationDelayPolicyCommand,
                    Delayed = false,
                },
            },
        };

        /// <summary>
        /// Two-pass fix (see <see cref="IUplinkCapabilityDeclarer"/>): the
        /// exclusive <c>"comms"</c> capability is declared HERE, in the pre-
        /// Register discovery pass, NOT in <see cref="Register"/>. That
        /// guarantees the capability exists before ANY uplink's
        /// <see cref="Register"/> runs, so RealAntennas' provider registration
        /// (a SEPARATE uplink, in its own <see cref="Register"/>) can never race
        /// ahead of this declaration and throw, regardless of assembly-scan
        /// discovery order. CommNet is the capability's always-present vanilla
        /// fallback; the engine calls <c>Kernel.Resolve()</c> once every uplink
        /// has registered its providers.
        /// </summary>
        public void DeclareCapabilities(Kernel kernel)
        {
            CommsElection.RegisterCapability(kernel, _ => new CommNetBackend());
        }

        public void Register(IUplinkHost host)
        {
            _kernel = host.Kernel;
            ConfigureSimulationKernel(host.Kernel);

            // The simulation delay policy, written by the console and read by
            // every delay reader through SignalDelayConfig above. Ground
            // infrastructure, so delayed:false: a preference about delay that
            // itself arrived four minutes late would be unusable exactly when
            // an operator wanted to change it.
            host.AddCommandHandler<SetSimulationDelayPolicyArgs, CommandResult>(
                SetSimulationDelayPolicyCommand,
                SetSimulationDelayPolicy);

            _connectivity = host.Publisher(ConnectivityTopic);
            _signalStrength = host.Publisher(SignalStrengthTopic);
            _controlState = host.Publisher(ControlStateTopic);
            _path = host.Publisher(PathTopic);
            _network = host.Publisher(NetworkTopic);
            _delay = host.Publisher(DelayTopic);
            _link = host.Publisher(LinkTopic);
            _occlusion = host.Publisher(OcclusionTopic);
            _commandCentre = host.Publisher(CommandCentreTopic);

            host.AddSampledSource(
                CaptureOnMain,
                HandleOnCourier,
                ConnectivityTopic,
                SignalStrengthTopic,
                ControlStateTopic,
                PathTopic,
                NetworkTopic,
                DelayTopic,
                LinkTopic,
                OcclusionTopic,
                CommandCentreTopic);

            // Advertise comms.delay to the engine's server-side reveal gate as
            // the AUTHORITATIVE, subscription-independent delay source (§7.3
            // Step 2). Without this the gate only ever learned the delay from a
            // pull-style AddChannelSource (which comms.delay is NOT, it rides
            // the main-thread capture above) or the subscription-gated wire
            // snoop, so a Delayed channel was delivered live whenever no client
            // subscribed comms.delay. This closure is evaluated on the MAIN
            // thread every tick (same seam as CaptureOnMain), so reading the
            // live elected backend is safe.
            host.SetSignalDelaySource(ComputeDelayOnMain);

            // Freeze-on-disconnect: advertise the CONNECTED/DISCONNECTED state to
            // the reveal gate the SAME subscription-independent, main-thread way
            // as the delay. When the control link is down, the gate withholds
            // (freezes) every Delayed channel instead of revealing it live off a
            // zero/None delay; on reconnect it drops the backlog and resumes. See
            // IUplinkHost.SetConnectivitySource.
            host.SetConnectivitySource(ComputeConnectedOnMain);

            // The silence.<guid>.* namespace: the SilenceTracker's officially-
            // lost reckoning for every fleet vessel. Registered HERE, on this
            // uplink's pass, so the engine attributes those channels to comms:
            // it is a comms-derived model's opinion, not core fleet telemetry
            // (which registers unconditionally via Gonogo.KSP.FleetChannels,
            // see that class's doc comment for the full split).
            new FleetSilenceChannels().RegisterInto(host);
        }

        /// <summary>
        /// MAIN-THREAD connectivity computation for the engine's reveal gate (see
        /// <see cref="IUplinkHost.SetConnectivitySource"/>): reads the elected
        /// backend's <see cref="ICommsBackend.Connectivity"/> live, exactly where
        /// <see cref="CaptureOnMain"/>/<see cref="ComputeDelayOnMain"/> run.
        /// Returns null pre-election (no backend), which the gate treats as "no
        /// authority yet" and leaves the last-known state untouched (default
        /// CONNECTED): never worse than today's LAN behaviour.
        /// </summary>
        internal bool? ComputeConnectedOnMain(KspSnapshot? snapshot)
        {
            // DEV-ONLY: see DevCommsOverride's doc comment. Resolves to null
            // (no-op) unless the GonogoDevTools assembly is loaded in this
            // process, so a real player install always falls through to the
            // real elected backend below, unchanged. When armed, this takes
            // priority over the real backend so a forced blackout reliably
            // freezes the reveal gate (SetConnectivitySource) even while a
            // real link is up - the whole point of a deterministic test
            // fixture instead of waiting on real occlusion/range.
            var devOverride = DevCommsOverride.Current;
            if (devOverride.HasValue)
            {
                return devOverride.Value;
            }

            var backend = _kernel != null ? CommsElection.Elected(_kernel) : null;
            if (backend == null)
            {
                return null;
            }

            // A transient backend-read THROW must NOT be swallowed into a hard
            // `false`. The reveal gate treats a `false` from this source as an
            // AUTHORITATIVE disconnect and FREEZES every Delayed channel, so a
            // scene-settle / vessel-unload / vessel-change tick where the read
            // throws (e.g. CommNetBackend's un-guarded Meta() dereferencing a
            // torn ActiveVessel) would wrongly freeze ALL vessel.* telemetry,
            // even though the link is up. Worse, the comms.connectivity CHANNEL
            // fail-softs the SAME throw the opposite way (its capture returns
            // null ⇒ keeps last-known `connected:true`), so the two diverge:
            // the channel reads connected while the gate stays frozen, the
            // exact live-KSP symptom.
            //
            // Let the throw PROPAGATE instead. The engine's recoverable
            // connectivity fail-soft (ChannelEngine.CaptureConnectivityOnMain →
            // RefreshConnectivityFromCapability) treats a thrown source as
            // CONNECTED and retries next tick: matching the reveal gate's own
            // documented "a source that threw ⇒ treated as CONNECTED" contract
            // and never worsening LAN behaviour. A GENUINE disconnect still
            // arrives as a clean `false` (Connection() null ⇒ Connected=false,
            // no throw) and still freezes, as intended.
            return backend.Connectivity().Connected;
        }

        /// <summary>
        /// Set the standing "apply signal delay during a simulation" policy.
        ///
        /// <para>The MOD owns this value, not the console, and that is
        /// deliberate: the mod is what enforces the delay, so a console
        /// preference the enforcer never heard would be a switch wired to
        /// nothing. It is written back to <c>PluginData/gonogo.cfg</c> so it
        /// survives a restart, beside the flag that turns delay on at
        /// all.</para>
        ///
        /// <para>A failed WRITE is not a failed command. The policy is in force
        /// from the moment this returns; all that is lost is remembering it next
        /// launch, and refusing a change that has already taken effect would
        /// leave the console showing the opposite of what the mod is doing.</para>
        /// </summary>
        internal static CommandResult SetSimulationDelayPolicy(SetSimulationDelayPolicyArgs? args)
        {
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.Range, "no policy given");
            }

            _signalDelayConfig.DelayInSimulation = args.ApplyDuringSimulation;
            GonogoConfigFile.WriteSignalDelayFlag(
                "delayInSimulation",
                args.ApplyDuringSimulation);
            return CommandResult.Ok();
        }

        /// <summary>
        /// MAIN-THREAD delay computation for the engine's reveal gate (see
        /// <see cref="IUplinkHost.SetSignalDelaySource"/>): the same elected-
        /// backend resolution + core <see cref="SignalDelay"/> light-time math
        /// <see cref="CaptureOnMain"/> performs for the <c>comms.delay</c>
        /// channel, factored out so the gate and the channel share one
        /// computation. Returns null pre-election (no backend), which the gate
        /// treats as "no delay authority yet" and leaves the last-known delay
        /// untouched.
        /// </summary>
        internal CommsDelay? ComputeDelayOnMain(KspSnapshot? snapshot)
        {
            var backend = _kernel != null ? CommsElection.Elected(_kernel) : null;
            if (backend == null)
            {
                return null;
            }

            // A transient backend-read THROW must PROPAGATE, not be swallowed
            // into a None result (OneWaySeconds null/0, per
            // CommsDelay.OneWaySeconds's typed-absence split). Dropping the
            // delay on a one-tick read blip would momentarily collapse the
            // reveal horizon and prematurely reveal a still-in-flight Delayed
            // sample. The
            // engine's recoverable delay fail-soft
            // (ChannelEngine.CaptureSignalDelayOnMain →
            // RefreshSignalDelayFromCapability → FailSoftSignalDelaySource)
            // instead leaves the LAST-KNOWN delay untouched and retries next
            // tick: the correct "never reveal earlier than the known horizon"
            // behaviour, symmetric with ComputeConnectedOnMain above.
            var path = backend.Path();
            return SignalDelay.Compute(
                _signalDelayConfig,
                path,
                path.Meta?.Source ?? "",
                path.Meta?.Quality ?? Quality.OnRails);
        }

        /// <summary>
        /// MAIN-THREAD capture: resolves the elected backend and reads every
        /// shared readout (live KSP reads, safe here), then computes the core
        /// SignalDelay from the captured hop geometry. Bundles plain payloads
        /// into a <see cref="CommsCapture"/>: no live KSP handles cross to the
        /// Courier thread.
        /// </summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var backend = _kernel != null ? CommsElection.Elected(_kernel) : null;
            if (backend == null)
            {
                return null; // election not resolved / no backend (pre-flight)
            }

            try
            {
                var path = backend.Path();
                var delay = SignalDelay.Compute(
                    _signalDelayConfig,
                    path,
                    path.Meta?.Source ?? "",
                    path.Meta?.Quality ?? Quality.OnRails);
                var connectivity = backend.Connectivity();

                // DEV-ONLY: mirror the same override ComputeConnectedOnMain
                // applies to the reveal gate into the comms.connectivity
                // CHANNEL payload too, so the app's own connectivity readout
                // agrees with the gate that is driving it - a forced
                // blackout that froze delayed channels while
                // comms.connectivity itself kept reporting "connected" would
                // be exactly the confusing half-state a real bug repro needs
                // to avoid. HasLocalControl is left untouched: local control
                // is a function of crew/probe core, not the comms link, so a
                // forced blackout should not also fake losing it.
                var devOverride = DevCommsOverride.Current;
                if (devOverride.HasValue)
                {
                    connectivity = new CommsConnectivity
                    {
                        Connected = devOverride.Value,
                        ControlSource = devOverride.Value ? connectivity.ControlSource : CommsControlSource.None,
                        HasLocalControl = connectivity.HasLocalControl,
                        Meta = connectivity.Meta,
                    };
                }

                // comms.commandCentre: which centre the vessel's OWN path
                // terminated at, KSC vs a crewed control-source vessel.
                //
                // Asked of the SEAM, in two halves. The elected backend says
                // which node its own path ended at, because the path is its;
                // core matches that node against its own centre registry,
                // because the registry is core's and an Uplink may not even
                // reference the type. This used to be one `backend is
                // CommNetBackend` downcast, under which the channel was all-null
                // forever on a RealAntennas install and therefore
                // indistinguishable from having no connection at all, dark
                // exactly where RSS/RA's dozen ground stations make "which one
                // am I talking to" a real question.
                //
                // A save with no comms model still lands on all-null, now via a
                // terminus nothing can report rather than via a downcast that
                // failed. That remains the right answer: a centre is where a
                // control PATH terminates, and there are no paths.
                var commandCentre = CommandCentreResolution.Resolve(
                    backend.ControlPathTerminus(), _commandCentreRegistry, connectivity.Meta);

                return new CommsCapture
                {
                    Ut = snapshot?.Ut ?? 0.0,
                    Connectivity = connectivity,
                    SignalStrength = backend.SignalStrength(),
                    ControlState = backend.ControlState(),
                    Path = path,
                    Network = backend.Network(),
                    Delay = delay,
                    // The backend declares the RULE; the body list it applies to
                    // comes from the snapshot this capture was already handed
                    // (the same one system.bodies reads), so no backend has to
                    // walk FlightGlobals itself.
                    Occlusion = OcclusionFor(backend, snapshot),
                    CommandCentre = commandCentre,
                };
            }
            catch (Exception)
            {
                // NULL-SAFE capture: a backend read that threw on a transient /
                // unloaded vessel yields no comms capture THIS tick (last-known
                // stays) rather than an exception that would fail-soft the whole
                // comms uplink. Retried next tick. The built-in CommNetBackend is
                // already exception-safe; this guards a third-party backend too.
                return null;
            }
        }

        /// <summary>
        /// MAIN-THREAD: the elected backend's declared occlusion model applied to
        /// the snapshot's body list. Rebuilding is cheap (a couple of dozen small
        /// objects), so it happens every tick and the result is compared to the
        /// last one; an unchanged declaration keeps the PREVIOUS instance, which
        /// is what makes the emitter's change-gate suppress it. See
        /// <see cref="_lastOcclusion"/>.
        /// </summary>
        private CommsOcclusion OcclusionFor(ICommsBackend backend, KspSnapshot? snapshot)
        {
            var built = CommsOcclusionBuilder.Build(backend.OcclusionModel(), snapshot);
            if (_lastOcclusion != null && CommsOcclusionBuilder.SameDeclaration(_lastOcclusion, built))
            {
                return _lastOcclusion;
            }

            _lastOcclusion = built;
            return built;
        }

        /// <summary>COURIER-THREAD handle: publishes the captured payloads. No KSP access.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not CommsCapture capture)
            {
                return;
            }
            _connectivity?.Publish(capture.Connectivity, capture.Ut);
            _signalStrength?.Publish(capture.SignalStrength, capture.Ut);
            _controlState?.Publish(capture.ControlState, capture.Ut);
            _path?.Publish(capture.Path, capture.Ut);
            _network?.Publish(capture.Network, capture.Ut);
            _delay?.Publish(capture.Delay, capture.Ut);
            _occlusion?.Publish(capture.Occlusion, capture.Ut);
            // comms.link: the client-facing, freeze-exempt-Delayed connectivity
            // successor. Same Connected the TrueNow comms.connectivity carries,
            // but on the topic clients read so the disconnect edge survives the
            // reveal-gate freeze. See LinkTopic's doc comment.
            _link?.Publish(new CommsLink
            {
                Connected = capture.Connectivity.Connected,
                Meta = capture.Connectivity.Meta,
            }, capture.Ut);
            _commandCentre?.Publish(capture.CommandCentre, capture.Ut);
        }

        /// <summary>
        /// The MANDATORY healthcheck (see <see cref="ISitrepUplink.Health"/>):
        /// polled on the Courier thread every <c>system.uplinks</c> sample.
        /// Reuses <see cref="CommsElection.Elected"/>, the exact same pure
        /// <see cref="Kernel"/> lookup <see cref="ComputeConnectedOnMain"/> and
        /// <see cref="CaptureOnMain"/> already call: no live KSP/Unity read,
        /// so it is safe and cheap off the main thread. The state machine
        /// itself is <see cref="CommsHealth"/>.
        /// </summary>
        public UplinkHealth Health() =>
            CommsHealth.Evaluate(_kernel != null && CommsElection.Elected(_kernel) != null);

        /// <summary>Plain cross-thread payload bundle: no live KSP references.</summary>
        private sealed class CommsCapture
        {
            public double Ut;
            public CommsConnectivity Connectivity = new();
            public CommsSignalStrength SignalStrength = new();
            public CommsControlState ControlState = new();
            public CommsPath Path = new();
            public CommsNetwork Network = new();
            public CommsDelay Delay = new();
            public CommsOcclusion Occlusion = new();
            public CommsCommandCentre CommandCentre = new();
        }
    }
}
