using System;
using System.Collections.Generic;
using Expansions;
using Gonogo.KSP.Gates;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The bundled, DLC-gated Breaking Ground (KSP Serenity) uplink: owns
    /// both the <c>robotics.*</c> and <c>deployed.*</c> prefixes: the robotics
    /// servo state/actuation and the deployed-science surfaces, held here
    /// rather than co-mingled with vanilla code in <see cref="PartsUplink"/>
    /// (robotics) and <see cref="ScienceCoreUplink"/> (deployed science). Shipped
    /// in the core mod DLL like <see cref="PartsUplink"/>/
    /// <see cref="VesselUplink"/> (auto-discovered, not a separate
    /// installable package). It registers its channels and commands whether or not
    /// Breaking Ground is installed and reports Unavailable through <see cref="Health"/>
    /// while the expansion is absent, gated on
    /// <c>ExpansionsLoader.IsExpansionInstalled("Serenity")</c>.
    ///
    /// <para>The raw KSP-side scan/actuation logic is unchanged by this
    /// extraction: robotics still reads <c>Values["parts"]["robotics"/
    /// "roboticsAvailable"]</c> (the same raw snapshot key
    /// <c>KspHost.BuildParts</c> populates for <see cref="PartsUplink"/>'s
    /// power channel: robotics and power are captured by the same sampler
    /// call, so sharing that snapshot key avoids introducing a new sampler
    /// seam), and deployed science reads the top-level
    /// <c>Values["deployedScience"]</c> (<c>KspHost.BuildDeployedScience</c>'s
    /// global <c>FlightGlobals.Vessels</c> walk). The KSP-free mapping itself lives in
    /// <see cref="BreakingGroundViewProvider"/>. Only which Uplink registers
    /// the channel sources + commands changed.</para>
    ///
    /// <para>Robotics actuation (servo/rotor set-target/motor/lock/brake/rpm/
    /// torque/reverse) rides here too, unchanged from <see cref="PartsUplink"/>'s
    /// old wiring: <see cref="RoboticsCommandProvider"/>'s <c>Handle*</c> glue
    /// against the <see cref="IRoboticsActuator"/> this uplink is constructed
    /// with (<see cref="KspRoboticsActuator"/> in production,
    /// <c>Sitrep.Host.Tests.FakeRoboticsActuator</c> in tests). Every command
    /// rides <c>delayed: true</c>: actuation of parts on the craft is an
    /// uplink that rides signal delay, the same class as
    /// <c>vessel.control.*</c>.</para>
    ///
    /// <para>Serenity is detected live, not at <see cref="Register"/>: KSP lists
    /// its installed expansions after the loading screen has begun, so a check at
    /// Register would condemn the Uplink on a machine that has the DLC.
    /// <see cref="Health"/> reports Unavailable while it is absent, the capture
    /// leaves the robotics and deployed groups out, and a robotics command finds
    /// no part to actuate and refuses.</para>
    /// </summary>
    [SitrepUplink("breakingGround")]
    public sealed class BreakingGroundUplink : ISitrepUplink
    {
        private readonly IRoboticsActuator _actuator;

        private IUplinkHost? _host;
        private IDynamicChannelSource? _stationSource;

        /// <summary>
        /// The same host, when it can also take a route's hops rather than only the
        /// scalar delay. Null leaves a station's delay on its scalar tier.
        /// </summary>
        private IVesselJourneyWriter? _journeyWriter;

        private readonly ExpansionHealth _expansion = new ExpansionHealth(
            () => ExpansionsLoader.IsExpansionInstalled("Serenity"),
            "Breaking Ground (Serenity) is not installed");

        public BreakingGroundUplink(IRoboticsActuator actuator)
        {
            _actuator = actuator;
        }

        /// <summary>
        /// The discovery-required parameterless constructor (see
        /// <c>Sitrep.Host.UplinkDiscovery</c>: a discoverable Uplink resolves
        /// its own dependencies rather than taking them as discovery-time
        /// arguments). Builds the real <see cref="KspRoboticsActuator"/>,
        /// mirroring <see cref="PartsUplink"/>'s old two-constructor shape.
        /// </summary>
        public BreakingGroundUplink() : this(new KspRoboticsActuator())
        {
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "breakingGround",
            Bundled = true,
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Kind = SampleKind.Continuous,
                    Requires = new[]
                    {
                        CareerGates.PartModuleResearched(
                            CareerGates.Modules.ServoHinge,
                            CareerGates.Modules.ServoPiston,
                            CareerGates.Modules.RotationServo,
                            CareerGates.Modules.ServoRotor),
                    },
                    Topic = BreakingGroundViewProvider.RoboticsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Vessel-sourced telemetry, rides the delay clock like vessel.*.
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    Kind = SampleKind.Discrete,
                    Requires = Requirement.None,
                    // "Does THIS vessel have any Breaking Ground servos", a
                    // single { available } wrapper. Vessel-derived (parts on
                    // the active vessel), so it rides the delay clock like
                    // RoboticsTopic above: NOT the ground-side DLC fact
                    // (game.dlc.breakingGround, a TrueNow SystemUplink channel).
                    Topic = BreakingGroundViewProvider.RoboticsAvailableTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                },
            },
            // Robotics actuation is an uplink to the craft, so every command
            // rides light-time like the vessel.control.* ones. Declared on the
            // args types, see SitrepCommandAttribute.Delay.
            Commands = new List<CommandDeclaration>
            {
                Command(RoboticsCommandProvider.ServoSetAngleCommand, BreakingGroundViewProvider.RoboticsTopic),
                Command(RoboticsCommandProvider.ServoSetExtensionCommand, BreakingGroundViewProvider.RoboticsTopic),
                Command(RoboticsCommandProvider.ServoSetMotorCommand, BreakingGroundViewProvider.RoboticsTopic),
                Command(RoboticsCommandProvider.ServoSetLockCommand, BreakingGroundViewProvider.RoboticsTopic),
                Command(RoboticsCommandProvider.RotorSetRpmLimitCommand, BreakingGroundViewProvider.RoboticsTopic),
                Command(RoboticsCommandProvider.RotorSetTorqueLimitCommand, BreakingGroundViewProvider.RoboticsTopic),
                Command(RoboticsCommandProvider.RotorSetBrakeCommand, BreakingGroundViewProvider.RoboticsTopic),
                Command(RoboticsCommandProvider.RotorSetMotorCommand, BreakingGroundViewProvider.RoboticsTopic),
                Command(RoboticsCommandProvider.RotorSetLockCommand, BreakingGroundViewProvider.RoboticsTopic),
                Command(RoboticsCommandProvider.RotorReverseCommand, BreakingGroundViewProvider.RoboticsTopic),
            },
        };

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>):
        /// Unavailable with the "Serenity not installed" reason while the DLC is
        /// absent, else Healthy.</summary>
        public UplinkHealth Health() => _expansion.Report();

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(BreakingGroundViewProvider.RoboticsTopic, BreakingGroundViewProvider.BuildRobotics);
            host.AddChannelSource(BreakingGroundViewProvider.RoboticsAvailableTopic, BreakingGroundViewProvider.BuildRoboticsAvailable);
            _host = host;
            _journeyWriter = host as IVesselJourneyWriter;
            _stationSource = host.RegisterDynamicNamespace(BreakingGroundViewProvider.StationPrefix, new ChannelDeclaration
            {
                Kind = SampleKind.Continuous,
                Requires = new[] { CareerGates.PartModuleResearched(CareerGates.Modules.GroundExperiment) },
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.Delayed,
                // Each station records on its controller vessel's own node, so its
                // science reveals at that vessel's delay and freezes on its link.
                PerVesselNode = true,
            });
            host.AddSampledSource(CaptureStationsOnMain, HandleStationsOnCourier, BreakingGroundViewProvider.StationPrefix);

            host.AddCommandHandler<ServoSetAngleArgs, CommandResult>(RoboticsCommandProvider.ServoSetAngleCommand, args => RoboticsCommandProvider.HandleServoSetAngle(_actuator, args));
            host.AddCommandHandler<ServoSetExtensionArgs, CommandResult>(RoboticsCommandProvider.ServoSetExtensionCommand, args => RoboticsCommandProvider.HandleServoSetExtension(_actuator, args));
            host.AddCommandHandler<ServoSetEnabledArgs, CommandResult>(RoboticsCommandProvider.ServoSetMotorCommand, args => RoboticsCommandProvider.HandleServoSetMotor(_actuator, args));
            host.AddCommandHandler<ServoSetEnabledArgs, CommandResult>(RoboticsCommandProvider.ServoSetLockCommand, args => RoboticsCommandProvider.HandleServoSetLock(_actuator, args));
            host.AddCommandHandler<RotorSetRpmLimitArgs, CommandResult>(RoboticsCommandProvider.RotorSetRpmLimitCommand, args => RoboticsCommandProvider.HandleRotorSetRpmLimit(_actuator, args));
            host.AddCommandHandler<RotorSetTorqueLimitArgs, CommandResult>(RoboticsCommandProvider.RotorSetTorqueLimitCommand, args => RoboticsCommandProvider.HandleRotorSetTorqueLimit(_actuator, args));
            host.AddCommandHandler<RotorSetBrakeArgs, CommandResult>(RoboticsCommandProvider.RotorSetBrakeCommand, args => RoboticsCommandProvider.HandleRotorSetBrake(_actuator, args));
            host.AddCommandHandler<ServoSetEnabledArgs, CommandResult>(RoboticsCommandProvider.RotorSetMotorCommand, args => RoboticsCommandProvider.HandleRotorSetMotor(_actuator, args));
            host.AddCommandHandler<ServoSetEnabledArgs, CommandResult>(RoboticsCommandProvider.RotorSetLockCommand, args => RoboticsCommandProvider.HandleRotorSetLock(_actuator, args));
            host.AddCommandHandler<RotorReverseArgs, CommandResult>(RoboticsCommandProvider.RotorReverseCommand, args => RoboticsCommandProvider.HandleRotorReverse(_actuator, args));
        }

        /// <summary>
        /// MAIN-THREAD: each station's wire payload, with its controller vessel's own
        /// routed delay and link. The delay is read here rather than borrowed from the
        /// fleet's per-craft capture, which runs only while a craft's own topics are
        /// watched.
        /// </summary>
        internal object? CaptureStationsOnMain(KspSnapshot? snapshot)
        {
            var stations = BreakingGroundViewProvider.BuildStations(snapshot);
            if (stations == null)
            {
                return null;
            }

            var config = CommsCoreUplink.SignalDelayConfig;
            var captures = new List<StationCapture>(stations.Count);
            foreach (var pair in stations)
            {
                var capture = new StationCapture { Id = pair.Key, Payload = pair.Value };
                if (Guid.TryParse(pair.Key, out var vesselId) && FlightGlobals.FindVessel(vesselId) is { } controller)
                {
                    var (oneWay, connected) = FleetCommsReader.ReadVessel(controller, config);
                    capture.OneWaySeconds = oneWay;
                    capture.Connected = connected;
                    capture.Journey = FleetCommsReader.ReadVesselJourney(controller, config);
                }
                captures.Add(capture);
            }
            return new StationsCapture { Ut = snapshot != null ? snapshot.Ut : 0.0, Stations = captures };
        }

        /// <summary>
        /// COURIER-THREAD: report each station's delay and link, then publish it.
        /// The link goes first so that a station whose path has just gone is already
        /// frozen when its reading is published, the same order the fleet keeps.
        /// </summary>
        internal void HandleStationsOnCourier(object? captured)
        {
            if (captured is not StationsCapture cap || _stationSource == null)
            {
                return;
            }

            foreach (var station in cap.Stations)
            {
                if (station.OneWaySeconds.HasValue)
                {
                    _host?.SetVesselDelay(station.Id, station.OneWaySeconds.Value);
                    // Written second: the scalar retires any journey already held.
                    if (station.Journey != null)
                    {
                        _journeyWriter?.SetVesselJourney(station.Id, station.Journey);
                    }
                }
                if (station.Connected is { } connected)
                {
                    _host?.SetVesselConnectivity(station.Id, connected);
                }
                _stationSource.Publisher(station.Id + BreakingGroundViewProvider.StationReportSuffix).Publish(station.Payload, cap.Ut);
            }
        }

        private sealed class StationsCapture
        {
            public double Ut { get; set; }
            public List<StationCapture> Stations { get; set; } = new List<StationCapture>();
        }

        private sealed class StationCapture
        {
            public string Id { get; set; } = "";
            public Dictionary<string, object?> Payload { get; set; } = new Dictionary<string, object?>();
            public double? OneWaySeconds { get; set; }
            public bool? Connected { get; set; }
            public Journey? Journey { get; set; }
        }

        private static CommandDeclaration Command(string command, string subject) => new CommandDeclaration
        {
            Command = command,
            Subject = subject,
            Requires = GateDeclarations.For(command),
        };
    }
}
