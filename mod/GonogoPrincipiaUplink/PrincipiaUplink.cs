// The [SitrepUplink("principia")] uplink: detection, plus the flight plan.
//
// Presence is still conveyed by system.uplinks health (Health() below) rather than
// by a principia.available topic, because nothing needs one: a client gates on the
// flight-plan channel carrying a sample, which is a stronger fact than the mod being
// loaded.
//
// It is ALSO the answer to a narrower question. `VesselPhysicsMode.IsPrincipiaActive`
// was deleted in the Major 2 -> 3 bump because "core detecting a specific
// third-party mod was a mod-seam violation; that awareness belongs to a future
// Principia Uplink instead". This is that Uplink, and detection is the whole of
// what it owns: nothing in core learns the mod's name, and the substantive fact
// reaches clients as a property of the ANSWER (an integrated trajectory, bounded
// by a horizon) rather than as the vendor's identity.
using Sitrep.Contract;

using System;
using System.Collections.Generic;
using System.IO;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Partial, and the other half is the only part that needs the game.
    ///
    /// <para><c>AttachObserver</c> is a partial method implemented in
    /// <c>PrincipiaUplink.Observer.cs</c>, which is the one file here that names a
    /// Harmony or KSP type. A build that omits that file (this uplink's headless
    /// test project) still compiles: an unimplemented partial method call is
    /// removed, the observer stays null, and every publish decision below remains
    /// exercisable with a fake. That is why the publish rule is testable at all,
    /// and it is the property to preserve when adding to this class.</para>
    /// </summary>
    [SitrepUplink("principia")]
    public sealed partial class PrincipiaUplink : ISitrepUplink
    {
        private readonly PrincipiaGuardResult _guard;

        public PrincipiaUplink()
            : this(PrincipiaVersionGuard.ProbeLoaded())
        {
        }

        /// <summary>Test seam: probe result injected, so the absent and present cases are both reachable without Principia.</summary>
        internal PrincipiaUplink(PrincipiaGuardResult guard)
        {
            _guard = guard;
            _detecting = PrincipiaBinaryHealth.Detecting(guard.DetectedVersion);
            _planCommands = new PlanCommands(() => _settings, () => _lastSettings);
        }

        /// <summary>Test seam: the observer injected too, so the publish rule is
        /// provable against a scripted sequence of observations.</summary>
        internal PrincipiaUplink(PrincipiaGuardResult guard, IFlightPlanObserver observer)
            : this(guard)
        {
            _observer = observer;
        }

        /// <summary>Test seam for the settings half, same reasoning.</summary>
        internal PrincipiaUplink(PrincipiaGuardResult guard, ISettingsSource settings)
            : this(guard)
        {
            _settings = settings;
        }

        /// <summary>Test seam for the force model, same reasoning: the registration
        /// is provable with no config database to read.</summary>
        internal PrincipiaUplink(PrincipiaGuardResult guard, IGravityModelSource gravityModel)
            : this(guard)
        {
            _gravityModel = gravityModel;
        }

        public const string FlightPlanTopic = "principia.flightPlan";
        public const string SettingsTopic = "principia.settings";
        public const string PlanTopic = "principia.plan";

        private IFlightPlanObserver? _observer;
        private ISettingsSource? _settings;
        private readonly SettingsReflection _settingsReader = new SettingsReflection();
        private readonly NativeSettingsReader _nativeSettingsReader = new NativeSettingsReader();
        private IChannelPublisher? _flightPlan;
        private IChannelPublisher? _settingsPublisher;
        private IChannelPublisher? _planPublisher;

        /// <summary>
        /// Whether the gate has already answered, read and written on the MAIN
        /// thread only.
        ///
        /// <para>Separate from <see cref="_binaryHealth"/>, which the Courier thread
        /// owns, so neither thread has to see the other's field to do its job. The
        /// gate runs at most once per session because its answer cannot change while
        /// the process lives (the mapped build stays mapped) and establishing it
        /// means scanning tens of megabytes and starting a worker process.</para>
        /// </summary>
        private bool _binaryGateHasRun;

        /// <summary>
        /// What the gate concluded, in roster terms.
        ///
        /// <para>Unsynchronised, and the reason is that only one thread touches it:
        /// the handle-on-Courier half of the sampled source writes it and
        /// <see cref="Health"/> reads it, and the host documents both as running on
        /// the Courier thread. The value itself is immutable once built, so a reader
        /// that somehow saw the reference early would still see a complete reading
        /// rather than a half-populated one.</para>
        /// </summary>
        private PrincipiaBinaryHealth? _binaryHealth;

        /// <summary>What the roster is told before the gate answers. Built once
        /// because it is polled on every sample and never changes.</summary>
        private readonly PrincipiaBinaryHealth _detecting;
        private readonly PlanReader _planReader = new PlanReader();
        private double _publishedAtUt = double.NegativeInfinity;

        /// <summary>
        /// The write half, reading its session from the same seam the settings
        /// channel does, through a lambda rather than a captured value: the settings
        /// source is attached during <c>Register</c> and a command handler runs long
        /// after, so a value captured at construction would be the null it was then.
        /// </summary>
        private readonly PlanCommands _planCommands;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "principia",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = FlightPlanTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                // TrueNow, unlike the flight plan beside it, and the difference is
                // real rather than an oversight. These are the operator's own
                // settings and the producer's local configuration: ground-side
                // facts about how the numbers are being computed, not observations
                // travelling from a craft. Delaying them would mean an operator
                // adjusting a tolerance could not see the new basis for their
                // readouts until light-time had passed, which is nonsense for a
                // setting they just changed on the same machine.
                new ChannelDeclaration
                {
                    Topic = SettingsTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                // Delayed, like the flight plan and unlike the settings beside it:
                // this is a per-vessel telemetry fact about a craft, not a
                // ground-side configuration.
                new ChannelDeclaration
                {
                    Topic = PlanTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
            Commands = new List<CommandDeclaration>
            {
                // All Delayed. A flight plan is what the craft will fly, and every
                // one of these writes moves a stock maneuver node on the vessel and
                // is persisted into the save, so they are craft actuation rather
                // than console preferences. The arm is Delayed too, and that is not
                // an oversight: arming RUNS the round-trip probe, which is a real
                // write of Principia's own burn back into the plan.
                new CommandDeclaration { Command = PlanCommands.ArmCommand, Delayed = true },
                new CommandDeclaration { Command = PlanCommands.ReplaceBurnCommand, Delayed = true },
                new CommandDeclaration { Command = PlanCommands.InsertBurnCommand, Delayed = true },
                new CommandDeclaration { Command = PlanCommands.RemoveBurnCommand, Delayed = true },
                new CommandDeclaration { Command = PlanCommands.HorizonCommand, Delayed = true },
                new CommandDeclaration { Command = PlanCommands.IntegratorCommand, Delayed = true },
                new CommandDeclaration { Command = PlanCommands.CreateCommand, Delayed = true },
                new CommandDeclaration { Command = PlanCommands.DeleteCommand, Delayed = true },
                new CommandDeclaration { Command = PlanCommands.DuplicateCommand, Delayed = true },
                // The composed send is Delayed like the rest, and more obviously so:
                // it is a command centre telling a craft what to fly, which is the
                // case the whole delay model exists for.
                new CommandDeclaration { Command = PlanCommands.SendCommand, Delayed = true },
            },
        };

        /// <summary>
        /// Attaches the flight-plan observer and sources its channel.
        ///
        /// <para>It also registers the propagation provider and the force model, in
        /// that order, and both are registrations rather than channels: nobody reads
        /// them on a screen, they are what a propagation is run through and against.
        /// See <see cref="RegisterPropagation"/> for what winning propagation
        /// actually states.</para>
        /// </summary>
        public void Register(IUplinkHost host)
        {
            if (!_guard.IsAvailable)
            {
                // The guard normally supplies a reason; the fallback names the
                // generic fact rather than an empty string, so an operator reading
                // the roster is never told nothing at all.
                host.SetAvailability(Availability.Unavailable(_guard.Reason ?? "Principia not detected"));
                return;
            }

            RegisterPropagation(host);
            RegisterGravityModel(host);
            RegisterControlFrame(host);
            RegisterManeuverPlan(host);
            AttachObserver();
            _observer?.TryAttach();
            _settings?.TryAttach();
            _flightPlan = host.Publisher(FlightPlanTopic);
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, FlightPlanTopic);
            _settingsPublisher = host.Publisher(SettingsTopic);
            host.AddSampledSource(CaptureSettingsOnMain, HandleSettingsOnCourier, SettingsTopic);
            // Keeps the plotting frame readable whether or not anyone subscribes
            // principia.settings.
            //
            // A sampled source runs only while its own topic has a subscriber,
            // and the control frame is read out of the same observation. Without
            // an ungated refresh, system.frame is a DEAD channel for any client
            // that subscribes to it alone: this uplink holds the controlFrame
            // capability exclusively, so answering null does not fall through to
            // the vanilla, and the topic emits nothing with no exception and no
            // log line to say why.
            //
            // Falling back to stock's answer would be worse than the silence.
            // Stock reports body-centred inertial, so a player sitting in a
            // pulsating frame would be told they were somewhere else.
            host.AddSampler(new SettingsRefresh(this));
            _planPublisher = host.Publisher(PlanTopic);
            host.AddSampledSource(CapturePlanOnMain, HandlePlanOnCourier, PlanTopic);
            // No topic prefixes, so the engine never skips it. What this source
            // feeds is the uplink's own health, which the roster polls whether or
            // not a client has subscribed to anything of ours; gating it on a
            // subscription would leave the roster describing a build nobody had
            // read yet for as long as nobody was looking.
            host.AddSampledSource(CaptureBinaryHealthOnMain, AdoptBinaryHealthOnCourier);
            RegisterPlanCommands(host);
        }

        /// <summary>
        /// Wires the ten plan-write handlers, and records the thread the host
        /// registered them on.
        ///
        /// <para>The thread is the point of doing this here. The host documents
        /// <c>Register</c> as running on the main thread, and every write on this
        /// surface has to run there too: Principia's plan members are main-thread
        /// only and a write destroys trajectory segments a renderer may be walking.
        /// Capturing the thread turns that requirement into something a refusal can
        /// state, instead of a comment nobody can test.</para>
        /// </summary>
        internal void RegisterPlanCommands(IUplinkHost host)
        {
            _planCommands.BindToCallingThread();
            host.AddCommandHandler<PrincipiaPlanArmArgs, CommandResult<Dictionary<string, object?>>>(
                PlanCommands.ArmCommand, _planCommands.Arm);
            host.AddCommandHandler<PrincipiaBurnEditArgs, CommandResult<Dictionary<string, object?>>>(
                PlanCommands.ReplaceBurnCommand, _planCommands.ReplaceBurn);
            host.AddCommandHandler<PrincipiaBurnEditArgs, CommandResult<Dictionary<string, object?>>>(
                PlanCommands.InsertBurnCommand, _planCommands.InsertBurn);
            host.AddCommandHandler<PrincipiaBurnRemoveArgs, CommandResult<Dictionary<string, object?>>>(
                PlanCommands.RemoveBurnCommand, _planCommands.RemoveBurn);
            host.AddCommandHandler<PrincipiaPlanHorizonArgs, CommandResult<Dictionary<string, object?>>>(
                PlanCommands.HorizonCommand, _planCommands.SetHorizon);
            host.AddCommandHandler<PrincipiaPlanIntegratorArgs, CommandResult<Dictionary<string, object?>>>(
                PlanCommands.IntegratorCommand, _planCommands.SetIntegrator);
            host.AddCommandHandler<PrincipiaPlanSlotArgs, CommandResult<Dictionary<string, object?>>>(
                PlanCommands.CreateCommand, _planCommands.CreatePlan);
            host.AddCommandHandler<PrincipiaPlanSlotArgs, CommandResult<Dictionary<string, object?>>>(
                PlanCommands.DeleteCommand, _planCommands.DeletePlan);
            host.AddCommandHandler<PrincipiaPlanSlotArgs, CommandResult<Dictionary<string, object?>>>(
                PlanCommands.DuplicateCommand, _planCommands.DuplicatePlan);
            host.AddCommandHandler<PrincipiaPlanSendArgs, CommandResult<Dictionary<string, object?>>>(
                PlanCommands.SendCommand, _planCommands.SendPlan);
        }

        /// <summary>
        /// MAIN-THREAD capture: asks the plugin for the selected plan, every tick.
        ///
        /// <para>Published every tick rather than on change, unlike the window
        /// mirror, and the difference is what the payload CLAIMS. That one asserts a
        /// past observation, so re-stamping it would move the observation forward in
        /// time; this one is the plugin's answer as of now and saying so repeatedly
        /// is honest.</para>
        ///
        /// <para>Null when there is nothing to say: no settings source, no session,
        /// no vessel, or a vessel Principia has forgotten. That is not the same fact
        /// as a vessel having no plan, which arrives as a sample with
        /// <c>planExists</c> false.</para>
        /// </summary>
        internal object? CapturePlanOnMain(KspSnapshot? snapshot)
        {
            var settings = _settings;
            if (settings == null)
            {
                return null;
            }
            var plan = _planReader.Read(
                settings.Session, settings.ActiveVesselGuid, snapshot?.Ut ?? 0.0);
            // Kept for the maneuver-plan source, which answers an election on the
            // Courier thread and cannot reach the producer itself. A reference
            // assignment, so a reader sees the previous observation or this one and
            // never a half-built one.
            _lastPlan = plan;
            return plan;
        }

        /// <summary>
        /// The most recent plan observation, or null before the first capture.
        /// Written on the main thread, read from the plan election.
        /// </summary>
        private volatile PlanObservation? _lastPlan;

        /// <summary>
        /// MAIN-THREAD capture: whether the Principia build this game loaded is one
        /// the Uplink may call into, in the shape <see cref="Health"/> reports.
        ///
        /// <para>Run from the sampled-source loop rather than from <c>Register</c>,
        /// and only once. Two reasons, and neither is tidiness. The gate scans tens
        /// of megabytes to find the embedded descriptor and starts a worker process,
        /// which is not something to do while the game is still building its scene.
        /// And the native build is mapped during Principia's own startup, so a read
        /// taken during registration can legitimately find nothing mapped at all and
        /// would record "Principia is not loaded" about a game that is about to load
        /// it.</para>
        ///
        /// <para>Returning null leaves the roster reading whatever it already had,
        /// which for the not-yet-mapped case is the detecting line. The gate is asked
        /// again on the next tick, which is what makes "still starting" resolve
        /// itself instead of sticking.</para>
        /// </summary>
        internal object? CaptureBinaryHealthOnMain(KspSnapshot? snapshot)
        {
            if (_binaryGateHasRun)
            {
                return null;
            }

            var verdict = PrincipiaConformanceGate.Check(
                MappedModules.OfThisProcess(),
                path => File.OpenRead(path));

            if (verdict.State == PrincipiaConformance.NotEstablished)
            {
                return null;
            }

            // Ask the worker what THIS machine reports, which is the one thing the
            // decision below cannot get any other way: reading CPUID here would
            // answer about whatever machine this code runs on, and the question is
            // about the game's. A worker beside the game is that machine.
            var hostFacts = AskTheWorker(verdict);
            var decision = PrincipiaWorkerHost.Decide(
                verdict, hostFacts, hostFacts, UsesCorrectSinCos);

            _binaryGateHasRun = true;
            return PrincipiaBinaryHealth.Of(_guard.DetectedVersion, verdict, decision);
        }

        /// <summary>
        /// COURIER-THREAD half: adopts the reading so the next roster poll reports
        /// it. Ignores anything else, including the null a tick with no verdict
        /// returns.
        /// </summary>
        internal void AdoptBinaryHealthOnCourier(object? captured)
        {
            if (captured is PrincipiaBinaryHealth reading)
            {
                _binaryHealth = reading;
            }
        }

        /// <summary>
        /// Whether the save routes trigonometry through Principia's own functions
        /// or the platform's C library.
        ///
        /// <para>Null, and honestly so. It is a field of the serialized plugin, no
        /// export reports it, and reading it means asking the plugin to serialise
        /// itself uncompressed and parsing field 21 out of the result. That is a
        /// real and known route and it is not built. Null makes the decision report
        /// `ReproducedExceptTrig` rather than claiming reproduction it has not
        /// established, which is the answer that costs nothing to be wrong
        /// about.</para>
        /// </summary>
        private static bool? UsesCorrectSinCos => null;

        /// <summary>
        /// Start a worker beside the game and ask it what the CPU reports, then stop
        /// it.
        ///
        /// <para>Once per session and only for a build that passed the gate: there
        /// is nothing to ask a worker about a build we would not call into anyway.
        /// The worker is disposed immediately because this one question is all it is
        /// asked so far, and a process left running for a value that cannot change
        /// is a process nobody remembers to stop.</para>
        ///
        /// <para>Every failure is unknown rather than false. No python, no script, a
        /// worker that dies: none of those are a CPU without FMA, and treating them
        /// as one would have the decision claim a match nobody measured.</para>
        /// </summary>
        private static PrincipiaHostFacts AskTheWorker(PrincipiaConformanceVerdict verdict)
        {
            var osFamily = OsFamily();
            if (verdict.State != PrincipiaConformance.Conformant || verdict.ActivePath == null)
            {
                return new PrincipiaHostFacts(osFamily, null);
            }

            using var channel = PrincipiaWorkerProcess.Spawn("python3", WorkerScriptPath());
            return PrincipiaWorkerProcess.AskCpuidFeatureFlags(
                channel, verdict.ActivePath, osFamily);
        }

        /// <summary>
        /// The worker script, found relative to this assembly rather than from a
        /// configured path: it ships beside the plugin and moves with it, and a
        /// path an operator could set is a path that can be set wrong.
        /// </summary>
        private static string WorkerScriptPath()
        {
            try
            {
                var plugins = Path.GetDirectoryName(
                    typeof(PrincipiaUplink).Assembly.Location);
                var root = plugins == null ? null : Path.GetDirectoryName(plugins);
                return root == null
                    ? string.Empty
                    : Path.Combine(root, "Worker", "principia_worker.py");
            }
            catch (Exception)
            {
                return string.Empty;
            }
        }

        private static string OsFamily()
        {
            var platform = Environment.OSVersion.Platform;
            if (platform == PlatformID.Unix)
            {
                // KSP on macOS also reports Unix, so the two are told apart by a path
                // only one of them has. Getting this wrong would call a Linux worker
                // and a macOS game the same machine.
                return Directory.Exists("/System/Library") ? "macos" : "linux";
            }
            return platform == PlatformID.MacOSX ? "macos" : "windows";
        }

        internal void HandlePlanOnCourier(object? captured)
        {
            if (captured is not PlanObservation observation)
            {
                return;
            }
            _planPublisher?.Publish(PlanBuilder.Build(observation), observation.SampledAtUt);
        }

        /// <summary>
        /// MAIN-THREAD capture: hands over the latched observation, but only once
        /// per observation.
        ///
        /// <para>Null until the planner has been rendered at least once, and null
        /// again on every tick that adds nothing new. That silence is deliberate and
        /// it is the honest shape: an unobserved plan produces NO sample, so a client
        /// reads "not observed" rather than a fabricated empty plan. Republishing an
        /// unchanged observation every tick would instead assert it afresh at each
        /// new instant, which is the one thing a stamped observation must never
        /// do.</para>
        /// </summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var latest = _observer?.Latest;
            if (latest == null || latest.ObservedAtUt <= _publishedAtUt)
            {
                return null;
            }
            _publishedAtUt = latest.ObservedAtUt;
            return latest;
        }

        /// <summary>
        /// COURIER-THREAD handle: publishes the plan AT THE INSTANT IT WAS OBSERVED,
        /// not at the current one.
        ///
        /// <para>That is the whole reason this channel is trustworthy. A sample
        /// stamped with its observation UT ages itself through the ordinary timeline
        /// machinery, so a plan last seen six hours ago arrives at a client as a
        /// six-hour-old sample and reads as stale with no special case anywhere.
        /// Stamping it "now" would make every stale plan look fresh, which is
        /// precisely the failure the hook exists to avoid.</para>
        /// </summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not FlightPlanObservation observation)
            {
                return;
            }
            _flightPlan?.Publish(FlightPlanBuilder.Build(observation), observation.ObservedAtUt);
        }

        /// <summary>
        /// MAIN-THREAD capture: reads every setting this tick, or says why it did
        /// not.
        ///
        /// <para>Published every tick rather than on change, unlike the flight plan.
        /// The difference is what the payload CLAIMS: a flight-plan sample asserts a
        /// past observation, so re-stamping it would move that observation forward in
        /// time, while these settings are true now and saying so repeatedly is
        /// honest.</para>
        ///
        /// <para><b>The journal check comes first, and it decides whether we read at
        /// all.</b> With a recorder running, the producer writes every call made
        /// through its plugin interface into the player's replay journal, ours
        /// included, and that journal is the artefact one of its bug reports is made
        /// of. So the managed half is read, the actual journaling state is taken from
        /// it, and if a recorder is active the whole reading is thrown away and
        /// replaced by a stated outage before the plugin is touched at all. It gates
        /// on the ACTUAL state rather than the requested one deliberately: the
        /// request only takes effect on load, so gating on it would stop us a session
        /// early and then fail to stop us at all in the case that matters.</para>
        /// </summary>
        internal object? CaptureSettingsOnMain(KspSnapshot? snapshot)
        {
            if (_settings == null)
            {
                return null;
            }
            var ut = snapshot?.Ut ?? 0.0;
            var version = _settings.Session?.Version;
            var observation = new SettingsObservation { SampledAtUt = ut, PluginVersion = version };
            _settingsReader.Read(_settings, observation);

            if (observation.Journaling == true)
            {
                return SettingsObservation.Suspended(ut, version, JournalSuspensionReason);
            }

            observation.TargetCelestialBody = _settings.TargetCelestialBody;
            _nativeSettingsReader.Read(_settings, observation);
            // Kept for the control-frame source, which answers a channel on the
            // Courier thread and so cannot reach the producer itself. A reference
            // assignment, which is atomic: the reader sees either the previous
            // observation or this one, never a half-built one.
            _lastSettings = observation;
            return observation;
        }

        /// <summary>
        /// The most recent settings observation, or null before the first capture.
        /// Written on the main thread, read from a channel mapper.
        /// </summary>
        private volatile SettingsObservation? _lastSettings;

        /// <summary>
        /// Reads the producer's settings every tick, so whatever is derived from
        /// them can be answered without their own topic being subscribed.
        ///
        /// <para>A sampler rather than a second sampled source, because that is
        /// the seam that runs unconditionally. The settings channel still takes
        /// its own reading when it is subscribed: that is one extra reflective
        /// read per tick in that case, and the alternative was routing a
        /// subscribed channel's payload through a field written by something
        /// else, which makes the channel's freshness depend on the sampler's
        /// order rather than on its own.</para>
        /// </summary>
        private sealed class SettingsRefresh : ISnapshotSampler
        {
            private readonly PrincipiaUplink _uplink;

            internal SettingsRefresh(PrincipiaUplink uplink) => _uplink = uplink;

            public void Sample(KspSnapshot snapshot) =>
                _uplink.CaptureSettingsOnMain(snapshot);
        }

        /// <summary>What an operator is told while we have stopped reading, and the
        /// one action that resumes it.</summary>
        internal const string JournalSuspensionReason =
            "Principia is recording a journal, so Gonogo has stopped reading from it. A journal "
            + "with our polling interleaved is no longer a replay of your session, and it is the "
            + "file a Principia bug report is made of. Turn off Record journal in Principia's "
            + "logging settings to resume.";

        internal void HandleSettingsOnCourier(object? captured)
        {
            if (captured is not SettingsObservation observation)
            {
                return;
            }
            _settingsPublisher?.Publish(
                SettingsBuilder.Build(observation), observation.SampledAtUt);
        }

        /// <summary>
        /// Unavailable is the ORDINARY answer, not a fault: Principia is optional
        /// and the stock two-body provider stays correct without it. The reason
        /// string is carried so the roster can say which of "not installed" and
        /// "installed but not a version we know" it is, because those want
        /// different actions from an operator.
        /// </summary>

        /// <summary>
        /// Publishes the producer's gravity model as the force model an n-body
        /// integration runs against.
        ///
        /// <para>The reading is a <c>GameDatabase</c> node and nothing else: it
        /// never touches the plugin, so the native ABI's abort-on-bad-call has
        /// nothing to fire on. That is why the force model is reachable at all,
        /// given every trajectory export is either a write or aborts on state we do
        /// not control.</para>
        ///
        /// <para>Registered rather than published on a channel because it is not
        /// telemetry. Nobody reads it on a screen; it is what a propagation runs
        /// against, so it goes where a propagation can resolve it and core never
        /// learns whose model it is.</para>
        ///
        /// <para>The try/catch is defence in depth on the same terms as every other
        /// Uplink's registration: a genuinely absent capability cannot happen in a
        /// correctly bundled install, and if one does this Uplink goes inert on that
        /// point rather than taking anything else down.</para>
        /// </summary>
        /// <summary>
        /// Wins the propagation capability, and by winning it states that
        /// trajectories in this install are integrated rather than closed-form.
        ///
        /// <para><b>That statement is the reason this exists, and nothing in core
        /// can make it.</b> An elected provider marked
        /// <see cref="IIntegratedTrajectorySource"/> is what turns a craft's
        /// published horizon from "these elements hold forever" into "they hold
        /// until this instant, and here is the arc it actually flies". Core is not
        /// allowed to know which physics mod is installed, so without a registration
        /// from here the marker had no implementer and the horizon reported
        /// closed-form on every frame of every install, including this one.</para>
        ///
        /// <para><b>Registered on the producer being present, not on the force model
        /// being readable.</b> Those are different facts with different remedies:
        /// the physics is n-body either way, and an unreadable model reaches a client
        /// as <see cref="TrajectoryRefusal.NoForceModel"/> on an integrated horizon.
        /// Standing down here instead would publish conic elements with no complaint
        /// attached, which reads as a working analytic install.</para>
        ///
        /// <para>The factory takes the displaced two-body solver from
        /// <see cref="ProviderContext.Vanilla{T}"/> and forwards every closed-form
        /// question to it. Winning propagation means answering the encounter and the
        /// visibility sweep too, and those are conic questions whose conic answers
        /// were already correct; a second copy of two-body motion in here to serve
        /// them is the duplication the seam exists to prevent.</para>
        ///
        /// <para>Resolved lazily inside the factory rather than constructed now:
        /// the vanilla does not exist until the election runs, which is after every
        /// Uplink has registered.</para>
        /// </summary>
        internal void RegisterPropagation(IUplinkHost host)
        {
            host.Kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = PropagationCapability.Id,
                Id = PrincipiaPropagationProvider.ProviderIdValue,
                Factory = ctx => new PrincipiaPropagationProvider(
                    ctx.Vanilla<IPropagationProvider>(PropagationCapability.Id)),
            });
        }

        /// <summary>
        /// Offers the producer's plotting frame as the game's control frame.
        ///
        /// <para>Registered unconditionally, unlike the gravity model beside it: a
        /// build with nothing to read answers null, which is the same answer stock
        /// gives before a craft has an orbit, and a client is told the same thing
        /// by both. There is nothing here that a missing config could make
        /// unanswerable, so there is no case for registering nothing.</para>
        /// </summary>
        internal void RegisterControlFrame(IUplinkHost host)
        {
            host.Kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = ControlFrameCapability.Id,
                Id = "principia",
                Factory = _ => new PrincipiaControlFrameSource(() => _lastSettings),
            });
        }

        /// <summary>
        /// Offers the producer's flight-plan burns as the craft's maneuver plan.
        ///
        /// <para>Winning this election is what makes stock's write path refuse:
        /// the plan owner is read off whoever won, and a stock actuator resolving
        /// a producer's burn id would answer NotFound to every edit. Refusing with
        /// a reason is the correct outcome there, and it is reachable only because
        /// something now competes for the capability at all.</para>
        /// </summary>
        internal void RegisterManeuverPlan(IUplinkHost host)
        {
            host.Kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = ManeuverPlanCapability.Id,
                Id = "principia",
                Factory = _ => new PrincipiaManeuverPlanSource(() => _lastPlan, _planCommands),
            });
        }

        internal void RegisterGravityModel(IUplinkHost host)
        {
            AttachGravityModel();
            var source = _gravityModel;
            if (source == null)
            {
                // A headless build has no way to read a config database, so it
                // registers nothing and the capability stays unsatisfied. That is
                // the same state an install without the producer is in, and a client
                // is told the same thing by both.
                return;
            }
            host.Kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = GravityModelCapability.Id,
                Id = source.ProviderId,
                Factory = _ => source,
            });
        }

        /// <summary>
        /// Sets <c>_gravityModel</c> to the real reader. Implemented only in the
        /// game-facing partial, on the same terms as <see cref="AttachObserver"/>:
        /// a build that omits that file registers no source and says so by leaving
        /// the capability unsatisfied.
        /// </summary>
        partial void AttachGravityModel();

        /// <summary>Test seam: the source injected, so registration is provable with no game.</summary>
        private IGravityModelSource? _gravityModel;

        /// <summary>Sets <c>_observer</c> to the real hook. Implemented only in the
        /// game-facing partial, so a headless build has no observer and says so by
        /// publishing nothing.</summary>
        partial void AttachObserver();

        /// <summary>
        /// Presence from the managed assembly, and everything else from the native
        /// build the game mapped.
        ///
        /// <para>The two are different questions and the roster answers both here
        /// rather than on a channel of this uplink's own. Which Principia is
        /// installed is not an observation of a craft: it is the identity of a file
        /// on the operator's machine, in the same class as every other fact this
        /// surface already carries about whether an uplink is working. A topic for
        /// it would have been a second place to look for the same answer, in a
        /// vocabulary only a Principia-aware client could read.</para>
        ///
        /// <para>Polled on every roster sample, so it does no work: the gate's answer
        /// is established once by the sampled source and this reads it.</para>
        /// </summary>
        public UplinkHealth Health()
        {
            if (!_guard.IsAvailable)
            {
                return new UplinkHealth(UplinkHealthState.Unavailable, _guard.Reason);
            }
            return (_binaryHealth ?? _detecting).ToHealth();
        }
    }
}
