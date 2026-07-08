using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Sitrep.Host.Comms;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The integration-test project's own tiny <see cref="ISitrepUplink"/>
    /// — NOT a copy of <c>Gonogo.KSP.SystemUplink</c> (this project can't
    /// reference the net472/KSP-referencing <c>Gonogo.KSP</c> assembly at
    /// all, per this project's own csproj comment), but a few lines instead
    /// of the ~300-line hand-copied <c>ReplayBodiesServer</c> the previous
    /// design required. Registers TWO channels against the same
    /// <see cref="ChannelEngine"/> the production mod uses:
    ///
    /// <list type="bullet">
    /// <item><description><c>system.bodies</c> — the REAL retrofit, using
    /// <see cref="SystemViewProvider.BuildSystemBodies"/> verbatim, exercised
    /// by <see cref="ReplayToWebSocketEndToEndTests"/>'s payload-shape
    /// assertions.</description></item>
    /// <item><description><c>test.raw</c> — a trivial passthrough mapper
    /// (reads <c>snapshot.Values["raw"]</c>) used by the low-level
    /// engine-mechanics tests (rewind, zero-subscriber gating) that push
    /// arbitrary dictionaries through the pipeline without caring about the
    /// real system.bodies schema — proof the engine handles more than one
    /// registered channel at once.</description></item>
    /// </list>
    /// </summary>
    internal sealed class TestSystemUplink : ISitrepUplink
    {
        public const string RawTopic = "test.raw";

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "test-system",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = SystemViewProvider.Topic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = RawTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(SystemViewProvider.Topic, SystemViewProvider.BuildSystemBodies);
            host.AddChannelSource(RawTopic, RawPassthrough);
        }

        private static object? RawPassthrough(KspSnapshot? snapshot)
        {
            if (snapshot == null || !snapshot.Values.TryGetValue("raw", out var value))
            {
                return null;
            }
            return value;
        }

        public static KspSnapshot RawSnapshot(double ut, object? rawPayload)
        {
            return new KspSnapshot
            {
                Ut = ut,
                Values = new Dictionary<string, object?> { ["raw"] = rawPayload },
            };
        }
    }

    /// <summary>
    /// M1 Task 4a milestone test's KSP-free replica of
    /// <c>Gonogo.KSP.VesselUplink</c> — same cross-project rationale as
    /// <see cref="TestSystemUplink"/>'s own doc comment: this project
    /// cannot reference the net472 <c>Gonogo.KSP</c> assembly, so the
    /// manifest/wiring (17 channels + 17 commands, verbatim from the real
    /// uplink) is duplicated here against a trivial
    /// <see cref="NoOpVesselActuator"/> rather than the real
    /// <c>KspVesselActuator</c>. This milestone suite replays a REAL
    /// recording (snapshots + lifecycle events only — no client ever
    /// dispatches a command against it), so a no-op actuator is sufficient:
    /// what's under test here is the READ pipeline (mapper -> channel ->
    /// courier -> transport -> client) for every declared channel, not
    /// command actuation (already covered by <c>VesselCommandProviderTests</c>
    /// and this project's own command-dispatch tests). <c>FakeVesselActuator</c>
    /// itself is `internal` to <c>Sitrep.Host.Tests</c> and unreachable from
    /// here for the same reason <c>Gonogo.KSP</c> is.
    /// </summary>
    internal sealed class TestVesselUplink : ISitrepUplink
    {
        private readonly IVesselActuator _actuator;

        public TestVesselUplink(IVesselActuator? actuator = null)
        {
            _actuator = actuator ?? new NoOpVesselActuator();
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "vessel",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Channel(VesselViewProvider.IdentityTopic),
                Channel(VesselViewProvider.OrbitTopic),
                Channel(VesselViewProvider.OrbitTruthTopic),
                Channel(VesselViewProvider.FlightTopic),
                Channel(VesselViewProvider.AttitudeTopic),
                Channel(VesselViewProvider.ResourcesTopic),
                Channel(VesselViewProvider.ThermalTopic),
                Channel(VesselViewProvider.ControlTopic),
                Channel(VesselViewProvider.CommsTopic),
                Channel(VesselViewProvider.PropulsionTopic),
                Channel(VesselViewProvider.ManeuverTopic),
                Channel(VesselViewProvider.TargetTopic),
                Channel(VesselViewProvider.CrewTopic),
                Channel(VesselViewProvider.StructureTopic),
                Channel(VesselViewProvider.WarpTopic),
                // ---- M3 R3 capture-adds ----
                Channel(VesselViewProvider.DockTopic),
                Channel(VesselViewProvider.SurfaceTopic),
            },
            Commands = new List<CommandDeclaration>
            {
                Command(VesselCommandProvider.SetSasCommand, delayed: true),
                Command(VesselCommandProvider.SetSasModeCommand, delayed: true),
                Command(VesselCommandProvider.SetRcsCommand, delayed: true),
                Command(VesselCommandProvider.SetGearCommand, delayed: true),
                Command(VesselCommandProvider.SetBrakesCommand, delayed: true),
                Command(VesselCommandProvider.SetLightsCommand, delayed: true),
                Command(VesselCommandProvider.SetAbortCommand, delayed: true),
                Command(VesselCommandProvider.SetThrottleCommand, delayed: true),
                Command(VesselCommandProvider.StageCommand, delayed: true),
                Command(VesselCommandProvider.SetActionGroupCommand, delayed: true),
                // F2: vessel.maneuver.* reclassified delayed:true (mirrors
                // Gonogo.KSP.VesselUplink's command-classification table).
                Command(VesselCommandProvider.ManeuverAddCommand, delayed: true),
                Command(VesselCommandProvider.ManeuverUpdateCommand, delayed: true),
                Command(VesselCommandProvider.ManeuverRemoveCommand, delayed: true),
                Command(VesselCommandProvider.TargetSetCommand, delayed: false),
                Command(VesselCommandProvider.TargetClearCommand, delayed: false),
                Command(VesselCommandProvider.SetWarpIndexCommand, delayed: false),
                Command(VesselCommandProvider.SetPausedCommand, delayed: false),
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(VesselViewProvider.IdentityTopic, VesselViewProvider.BuildIdentityWire);
            host.AddChannelSource(VesselViewProvider.OrbitTopic, VesselViewProvider.BuildOrbitWire);
            host.AddChannelSource(VesselViewProvider.OrbitTruthTopic, VesselViewProvider.BuildOrbitTruthWire);
            host.AddChannelSource(VesselViewProvider.FlightTopic, VesselViewProvider.BuildFlightWire);
            host.AddChannelSource(VesselViewProvider.AttitudeTopic, VesselViewProvider.BuildAttitudeWire);
            host.AddChannelSource(VesselViewProvider.ResourcesTopic, VesselViewProvider.BuildResourcesWire);
            host.AddChannelSource(VesselViewProvider.ThermalTopic, VesselViewProvider.BuildThermalWire);
            host.AddChannelSource(VesselViewProvider.ControlTopic, VesselViewProvider.BuildControlWire);
            host.AddChannelSource(VesselViewProvider.CommsTopic, VesselViewProvider.BuildCommsWire);
            host.AddChannelSource(VesselViewProvider.PropulsionTopic, VesselViewProvider.BuildPropulsionWire);
            host.AddChannelSource(VesselViewProvider.ManeuverTopic, VesselViewProvider.BuildManeuverWire);
            host.AddChannelSource(VesselViewProvider.TargetTopic, VesselViewProvider.BuildTargetWire);
            host.AddChannelSource(VesselViewProvider.CrewTopic, VesselViewProvider.BuildCrewWire);
            host.AddChannelSource(VesselViewProvider.StructureTopic, VesselViewProvider.BuildStructureWire);
            host.AddChannelSource(VesselViewProvider.WarpTopic, VesselViewProvider.BuildWarpWire);
            host.AddChannelSource(VesselViewProvider.DockTopic, VesselViewProvider.BuildDockWire);
            host.AddChannelSource(VesselViewProvider.SurfaceTopic, VesselViewProvider.BuildSurfaceWire);

            host.AddSampler(new VesselEpochSampler(host));

            host.AddCommandHandler<SetEnabledArgs, CommandResult>(VesselCommandProvider.SetSasCommand, args => VesselCommandProvider.HandleSetSas(_actuator, args));
            host.AddCommandHandler<SetSasModeArgs, CommandResult>(VesselCommandProvider.SetSasModeCommand, args => VesselCommandProvider.HandleSetSasMode(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, CommandResult>(VesselCommandProvider.SetRcsCommand, args => VesselCommandProvider.HandleSetRcs(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, CommandResult>(VesselCommandProvider.SetGearCommand, args => VesselCommandProvider.HandleSetGear(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, CommandResult>(VesselCommandProvider.SetBrakesCommand, args => VesselCommandProvider.HandleSetBrakes(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, CommandResult>(VesselCommandProvider.SetLightsCommand, args => VesselCommandProvider.HandleSetLights(_actuator, args));
            host.AddCommandHandler<SetEnabledArgs, CommandResult>(VesselCommandProvider.SetAbortCommand, args => VesselCommandProvider.HandleSetAbort(_actuator, args));
            host.AddCommandHandler<SetThrottleArgs, CommandResult>(VesselCommandProvider.SetThrottleCommand, args => VesselCommandProvider.HandleSetThrottle(_actuator, args));
            host.AddCommandHandler<object?, CommandResult<int>>(VesselCommandProvider.StageCommand, args => VesselCommandProvider.HandleStage(_actuator, args));
            host.AddCommandHandler<SetActionGroupArgs, CommandResult>(VesselCommandProvider.SetActionGroupCommand, args => VesselCommandProvider.HandleSetActionGroup(_actuator, args));
            host.AddCommandHandler<AddManeuverNodeArgs, CommandResult<string>>(VesselCommandProvider.ManeuverAddCommand, args => VesselCommandProvider.HandleManeuverAdd(_actuator, args));
            host.AddCommandHandler<UpdateManeuverNodeArgs, CommandResult>(VesselCommandProvider.ManeuverUpdateCommand, args => VesselCommandProvider.HandleManeuverUpdate(_actuator, args));
            host.AddCommandHandler<RemoveManeuverNodeArgs, CommandResult>(VesselCommandProvider.ManeuverRemoveCommand, args => VesselCommandProvider.HandleManeuverRemove(_actuator, args));
            host.AddCommandHandler<SetTargetArgs, CommandResult>(VesselCommandProvider.TargetSetCommand, args => VesselCommandProvider.HandleTargetSet(_actuator, args));
            host.AddCommandHandler<object?, CommandResult>(VesselCommandProvider.TargetClearCommand, args => VesselCommandProvider.HandleTargetClear(_actuator, args));
            host.AddCommandHandler<SetWarpIndexArgs, CommandResult>(VesselCommandProvider.SetWarpIndexCommand, args => VesselCommandProvider.HandleSetWarpIndex(_actuator, args));
            host.AddCommandHandler<SetPausedArgs, CommandResult>(VesselCommandProvider.SetPausedCommand, args => VesselCommandProvider.HandleSetPaused(_actuator, args));
        }

        private static ChannelDeclaration Channel(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        private static CommandDeclaration Command(string command, bool delayed) => new CommandDeclaration
        {
            Command = command,
            Delayed = delayed,
        };
    }

    /// <summary>
    /// KSP-free integration-test replica of <c>Gonogo.KSP.CareerUplink</c>
    /// — that assembly is net472/KSP-referencing and unreachable from this
    /// project, same cross-project rationale as <see cref="TestSystemUplink"/>'s
    /// own doc comment. Registers the <c>career.status</c> channel against
    /// <see cref="CareerViewProvider.BuildCareer"/> verbatim, so the
    /// domain wire-fixture generator can replay a career-mode recording
    /// through the real engine pipeline exactly like a live capture would.
    /// </summary>
    internal sealed class TestCareerUplink : ISitrepUplink
    {
        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "test-career",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = CareerViewProvider.Topic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(CareerViewProvider.Topic, CareerViewProvider.BuildCareer);
        }
    }

    /// <summary>
    /// KSP-free integration-test replica of <c>Gonogo.KSP.ScienceUplink</c>
    /// — same cross-project rationale as <see cref="TestSystemUplink"/>'s
    /// doc comment. Registers all three <c>science.*</c> channels against
    /// <see cref="ScienceViewProvider"/>'s builders verbatim, so the domain
    /// wire-fixture generator can replay a science-mode recording through
    /// the real engine pipeline exactly like a live capture would.
    /// </summary>
    internal sealed class TestScienceUplink : ISitrepUplink
    {
        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "test-science",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.ExperimentsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.LabTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.DeployedTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(ScienceViewProvider.ExperimentsTopic, ScienceViewProvider.BuildExperiments);
            host.AddChannelSource(ScienceViewProvider.LabTopic, ScienceViewProvider.BuildLab);
            host.AddChannelSource(ScienceViewProvider.DeployedTopic, ScienceViewProvider.BuildDeployed);
        }
    }

    /// <summary>
    /// KSP-free integration-test replica of <c>Gonogo.KSP.PartsUplink</c>
    /// — same cross-project rationale as <see cref="TestSystemUplink"/>'s
    /// doc comment. Registers both <c>parts.*</c> channels against
    /// <see cref="PartsViewProvider"/>'s builders verbatim, so the domain
    /// wire-fixture generator can replay a parts/robotics-mode recording
    /// through the real engine pipeline exactly like a live capture would.
    /// </summary>
    internal sealed class TestPartsUplink : ISitrepUplink
    {
        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "test-parts",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = PartsViewProvider.PowerTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = PartsViewProvider.RoboticsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(PartsViewProvider.PowerTopic, PartsViewProvider.BuildPower);
            host.AddChannelSource(PartsViewProvider.RoboticsTopic, PartsViewProvider.BuildRobotics);
        }
    }

    /// <summary>
    /// Exercises the SERVER-SIDE reveal gate (spec-streaming-delay-model §4 /
    /// §7.3 Steps 1–3). Declares three channels spanning the delay roles a raw
    /// (non-SDK) client sees over the wire:
    /// <list type="bullet">
    /// <item><description><c>comms.delay</c> — TrueNow; the delay AUTHORITY.
    /// Its <see cref="CommsDelay"/> payload sets the one-way delay the gate
    /// applies to every Delayed channel, and it must never be gated by the
    /// delay it defines.</description></item>
    /// <item><description><c>rev.delayed</c> — Delayed; withheld until its UT
    /// crosses the reveal horizon (now − delay).</description></item>
    /// <item><description><c>rev.truenow</c> — TrueNow; revealed live regardless
    /// of the delay.</description></item>
    /// </list>
    /// All three are pull channels reading the tick snapshot's Values bag, so a
    /// test drives them purely through <c>TickAndWait</c>.
    /// </summary>
    internal sealed class RevealGateTestUplink : ISitrepUplink
    {
        public const string DelayedTopic = "rev.delayed";
        public const string TrueNowTopic = "rev.truenow";

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "reveal-gate-test",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = ChannelEngine.CommsDelayTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
                new ChannelDeclaration
                {
                    Topic = DelayedTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    Topic = TrueNowTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(ChannelEngine.CommsDelayTopic, MapDelay);
            host.AddChannelSource(DelayedTopic, snapshot => Read(snapshot, "delayed"));
            host.AddChannelSource(TrueNowTopic, snapshot => Read(snapshot, "truenow"));
        }

        private static object? MapDelay(KspSnapshot? snapshot)
        {
            var raw = Read(snapshot, "delay");
            if (raw == null)
            {
                return null;
            }
            return new CommsDelay
            {
                OneWaySeconds = Convert.ToDouble(raw),
                Source = CommsDelaySource.SignalDelay,
            };
        }

        private static object? Read(KspSnapshot? snapshot, string key)
        {
            if (snapshot == null || !snapshot.Values.TryGetValue(key, out var value))
            {
                return null;
            }
            return value;
        }

        /// <summary>Build a tick snapshot. Any argument left null is simply absent from the Values bag (its channel emits nothing that tick).</summary>
        public static KspSnapshot Snapshot(double ut, double? delay = null, double? delayed = null, double? trueNow = null)
        {
            var values = new Dictionary<string, object?>();
            if (delay.HasValue)
            {
                values["delay"] = delay.Value;
            }
            if (delayed.HasValue)
            {
                values["delayed"] = delayed.Value;
            }
            if (trueNow.HasValue)
            {
                values["truenow"] = trueNow.Value;
            }
            return new KspSnapshot { Ut = ut, Values = values };
        }
    }

    /// <summary>
    /// KSP-FREE integration-test replica of the bundled
    /// <c>Gonogo.KSP.CommsCoreUplink</c> — that assembly is net472/KSP-
    /// referencing and unreachable from this project (same cross-project
    /// rationale as <see cref="TestSystemUplink"/>'s doc comment), and it
    /// hard-references <c>Gonogo.KSP.CommNetBackend</c> (a live-KSP
    /// <see cref="ICommsBackend"/>) as its vanilla factory. Everything ELSE
    /// the real uplink does is KSP-independent and reused verbatim here:
    /// <list type="bullet">
    /// <item>it OWNS the exclusive <c>"comms"</c> capability via
    /// <see cref="CommsElection.RegisterCapability"/> (the two-pass
    /// <see cref="IUplinkCapabilityDeclarer"/> path), but backed by a
    /// synthetic <see cref="FakeCommsBackend"/> that supplies hop geometry
    /// instead of the live CommNet backend;</item>
    /// <item>it declares <c>comms.delay</c> as a TRUE-NOW channel (§1 — the
    /// value that DEFINES the delay is never itself delay-gated) and sources
    /// it from the CORE <see cref="SignalDelay.Compute"/> light-time math over
    /// the elected backend's <see cref="CommsPath"/> — gonogo's own
    /// computation, resolved every tick via
    /// <c>Kernel.Query&lt;ICommsBackend&gt;</c>, exactly as the real uplink's
    /// <c>CaptureOnMain</c> does.</item>
    /// </list>
    ///
    /// <para>Only <c>comms.delay</c> is declared here: it is the single
    /// <c>comms.*</c> payload <see cref="Sitrep.Core.Serialization.JsonWriter"/>
    /// can serialize to the wire today (the other comms payload POCOs —
    /// <see cref="CommsConnectivity"/> etc. — have no wire flatten and are
    /// covered at the contract/election level, see
    /// <c>CommsCoreEndToEndTests</c>). It is also the one channel that DRIVES
    /// the server-side reveal gate (<see cref="ChannelEngine"/>'s
    /// <c>RefreshSignalDelayFromCapability</c> reads exactly this registered
    /// source every tick), so it is the meaningful end-to-end comms surface.</para>
    /// </summary>
    internal sealed class TestCommsCoreUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        public const string DelayTopic = ChannelEngine.CommsDelayTopic;

        private readonly double? _hopDistanceMeters;
        private readonly SignalDelayConfig _config;
        private Kernel? _kernel;

        /// <param name="hopDistanceMeters">
        /// One-hop distance the synthetic backend reports to KSC. Null models a
        /// backend that can't supply per-hop geometry (SignalDelay then yields
        /// <see cref="CommsDelaySource.None"/>).
        /// </param>
        /// <param name="signalDelayEnabled">
        /// Whether the core SignalDelay capability is flag-enabled (§3). Off ⇒
        /// <c>comms.delay</c> is 0 / <see cref="CommsDelaySource.None"/>.
        /// </param>
        public TestCommsCoreUplink(double? hopDistanceMeters, bool signalDelayEnabled)
        {
            _hopDistanceMeters = hopDistanceMeters;
            _config = signalDelayEnabled
                ? new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 }
                : SignalDelayConfig.Off();
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "test-comms",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = DelayTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void DeclareCapabilities(Kernel kernel) =>
            CommsElection.RegisterCapability(kernel, _ => new FakeCommsBackend("commnet", _hopDistanceMeters));

        public void Register(IUplinkHost host)
        {
            _kernel = host.Kernel;
            host.AddChannelSource(DelayTopic, MapDelay);
        }

        private object? MapDelay(KspSnapshot? snapshot)
        {
            var backend = _kernel != null ? CommsElection.Elected(_kernel) : null;
            if (backend == null)
            {
                return null;
            }
            var path = backend.Path();
            return SignalDelay.Compute(
                _config,
                path,
                path.Meta?.Source ?? "",
                path.Meta?.Quality ?? Quality.OnRails);
        }

        /// <summary>
        /// The one-way light-time (seconds) the core <see cref="SignalDelay"/>
        /// math produces for this uplink's synthetic hop geometry at real
        /// light-speed — the exact value a test asserts <c>comms.delay</c>
        /// carries on the wire.
        /// </summary>
        public double ExpectedOneWaySeconds =>
            (_hopDistanceMeters ?? 0.0) / SignalDelay.SpeedOfLightMetersPerSecond;

        /// <summary>
        /// KSP-free <see cref="ICommsBackend"/> — supplies exactly the shared
        /// readouts both real backends honour (§6), with a single ground-hop
        /// carrying the injected distance so <see cref="SignalDelay"/> has real
        /// geometry to integrate over.
        /// </summary>
        internal sealed class FakeCommsBackend : ICommsBackend
        {
            private readonly double? _hopDistanceMeters;

            public FakeCommsBackend(string id, double? hopDistanceMeters)
            {
                BackendId = id;
                _hopDistanceMeters = hopDistanceMeters;
            }

            public string BackendId { get; }

            public CommsConnectivity Connectivity() => new CommsConnectivity
            {
                Connected = true,
                ControlSource = CommsControlSource.Full,
                HasLocalControl = true,
                Meta = new PayloadMeta { Source = "game", Quality = Quality.Loaded },
            };

            public CommsSignalStrength SignalStrength() => new CommsSignalStrength
            {
                Value = 0.87,
                Meta = new PayloadMeta { Source = "game", Quality = Quality.Loaded },
            };

            public CommsControlState ControlState() => new CommsControlState
            {
                State = CommsControlStateKind.Full,
                Meta = new PayloadMeta { Source = "game", Quality = Quality.Loaded },
            };

            public CommsPath Path() => new CommsPath
            {
                Hops = new List<CommsHop>
                {
                    new CommsHop
                    {
                        From = "vessel",
                        To = "kerbin-ksc",
                        Kind = CommsHopKind.Home,
                        DistanceMeters = _hopDistanceMeters,
                    },
                },
                Meta = new PayloadMeta { Source = "game", Quality = Quality.Loaded },
            };

            public CommsNetwork Network() => new CommsNetwork
            {
                Meta = new PayloadMeta { Source = "game", Quality = Quality.Loaded },
            };
        }
    }

    /// <summary>
    /// Two role-carrying channels for the full-chain delay proof
    /// (<c>RevealGateTests.FullChainDelayOverRealBackendComputedDelay</c>) —
    /// deliberately WITHOUT a <c>comms.delay</c> channel of its own, so the
    /// delay authority is owned solely by <see cref="TestCommsCoreUplink"/>
    /// (whose value the reveal gate computes from real hop geometry). A
    /// <c>vessel.*</c>-shaped Delayed channel plus a <c>time.warp</c>-shaped
    /// TrueNow channel, both sourced from the tick snapshot's Values bag.
    /// </summary>
    internal sealed class DelayRolesTestUplink : ISitrepUplink
    {
        public const string DelayedTopic = "vessel.flight";
        public const string TrueNowTopic = "time.warp";

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "test-delay-roles",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = DelayedTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    Topic = TrueNowTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(DelayedTopic, snapshot => Read(snapshot, "delayed"));
            host.AddChannelSource(TrueNowTopic, snapshot => Read(snapshot, "truenow"));
        }

        private static object? Read(KspSnapshot? snapshot, string key)
        {
            if (snapshot == null || !snapshot.Values.TryGetValue(key, out var value))
            {
                return null;
            }
            return value;
        }

        public static KspSnapshot Snapshot(double ut, double? delayed = null, double? trueNow = null)
        {
            var values = new Dictionary<string, object?>();
            if (delayed.HasValue)
            {
                values["delayed"] = delayed.Value;
            }
            if (trueNow.HasValue)
            {
                values["truenow"] = trueNow.Value;
            }
            return new KspSnapshot { Ut = ut, Values = values };
        }
    }

    /// <summary>
    /// Trivial no-op <see cref="IVesselActuator"/> for <see cref="TestVesselUplink"/>
    /// — every call succeeds and does nothing observable. Sufficient for this
    /// project's replay-driven tests, none of which dispatch a vessel command
    /// against the real recording (it contains only snapshots/lifecycle
    /// events — see <see cref="TestVesselUplink"/>'s own doc comment).
    /// </summary>
    internal sealed class NoOpVesselActuator : IVesselActuator
    {
        public CommandResult SetSas(bool enabled) => CommandResult.Ok();
        public CommandResult SetSasMode(SasMode mode) => CommandResult.Ok();
        public CommandResult SetRcs(bool enabled) => CommandResult.Ok();
        public CommandResult SetGear(bool enabled) => CommandResult.Ok();
        public CommandResult SetBrakes(bool enabled) => CommandResult.Ok();
        public CommandResult SetLights(bool enabled) => CommandResult.Ok();
        public CommandResult SetAbort(bool enabled) => CommandResult.Ok();
        public CommandResult SetThrottle(double value) => CommandResult.Ok();
        public CommandResult<int> Stage() => CommandResult<int>.Ok(1);
        public CommandResult SetActionGroup(int group, bool state) => CommandResult.Ok();
        public CommandResult<string> AddManeuverNode(double ut, double prograde, double normal, double radialOut) =>
            CommandResult<string>.Ok("node-1");
        public CommandResult UpdateManeuverNode(string nodeId, double ut, double prograde, double normal, double radialOut) => CommandResult.Ok();
        public CommandResult RemoveManeuverNode(string nodeId) => CommandResult.Ok();
        public CommandResult SetTarget(TargetKind kind, string? vesselId, int? bodyIndex) => CommandResult.Ok();
        public CommandResult ClearTarget() => CommandResult.Ok();
        public CommandResult SetWarp(int index) => CommandResult.Ok();
        public CommandResult SetPause(bool paused) => CommandResult.Ok();
    }

    /// <summary>
    /// Exercises <see cref="IUplinkHost.RegisterDynamicNamespace"/> — the
    /// contract's dynamic-topic mechanism (see
    /// <c>.superpowers/sdd/contract-dynamic-delay-report.md</c>). Registers
    /// ONE dynamic namespace (<see cref="Prefix"/>) with a template
    /// declaration, then lets a test publish to any runtime-computed
    /// sub-topic under it via <see cref="PublishTo"/> without that sub-topic
    /// ever appearing in <see cref="Manifest"/>.
    /// </summary>
    internal sealed class DynamicNamespaceTestUplink : ISitrepUplink
    {
        public const string Prefix = "dyn.";

        private IDynamicChannelSource? _source;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "dyn-test",
            Version = "1.0.0",
        };

        public void Register(IUplinkHost host)
        {
            _source = host.RegisterDynamicNamespace(Prefix, new ChannelDeclaration
            {
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.Delayed,
            });
        }

        /// <summary>Publish to <c>Prefix + subTopic</c> — the sub-topic need not have been used before.</summary>
        public void PublishTo(string subTopic, object? payload, double ut) =>
            (_source ?? throw new InvalidOperationException("Register was never called")).Publisher(subTopic).Publish(payload, ut);
    }

    /// <summary>
    /// Exercises the F1-hardening Fix #3 subscription gate on the
    /// capture-on-main / handle-on-Courier seam
    /// (<see cref="IUplinkHost.AddSampledSource(System.Func{KspSnapshot?, object?}, System.Action{object?}, string[])"/>).
    /// Registers ONE channel (<see cref="Topic"/>) and a sampled source that
    /// declares that topic as its produced prefix, then publishes the tick's
    /// UT through it. <see cref="CaptureCount"/> counts how many times the
    /// main-thread capture actually ran — expected to stay 0 while nothing is
    /// subscribed and increment only once a subscriber exists.
    /// </summary>
    internal sealed class SampledGateTestUplink : ISitrepUplink
    {
        public const string Topic = "sampled.gate";

        private int _captureCount;
        private IChannelPublisher? _publisher;

        public int CaptureCount => System.Threading.Volatile.Read(ref _captureCount);

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "sampled-gate",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = Topic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            _publisher = host.Publisher(Topic);
            host.AddSampledSource(Capture, Handle, Topic);
        }

        private object? Capture(KspSnapshot? snapshot)
        {
            System.Threading.Interlocked.Increment(ref _captureCount);
            return snapshot?.Ut ?? 0.0;
        }

        private void Handle(object? captured) => _publisher!.Publish(captured, Convert.ToDouble(captured));
    }
}
