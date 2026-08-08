using System.Collections.Generic;
using Expansions;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The bundled, DLC-gated Breaking Ground (KSP Serenity) uplink: owns
    /// BOTH the <c>robotics.*</c> and <c>deployed.*</c> prefixes, the
    /// robotics servo state/actuation and the deployed-science surfaces that
    /// used to be co-mingled with vanilla code in <see cref="PartsUplink"/>
    /// (robotics) and <see cref="ScienceUplink"/> (deployed science). Shipped
    /// IN the core mod DLL like <see cref="PartsUplink"/>/
    /// <see cref="VesselUplink"/> (auto-discovered, not a separate
    /// installable package), but goes INERT when Breaking Ground isn't
    /// installed, gated on <c>ExpansionsLoader.IsExpansionInstalled("Serenity")</c>,
    /// mirroring <c>Gonogo.ScansatUplink.ScansatUplink</c>'s graceful-absence
    /// pattern (see its own doc comment).
    ///
    /// <para>The raw KSP-side scan/actuation logic is unchanged by this
    /// extraction: robotics still reads <c>Values["parts"]["robotics"/
    /// "roboticsAvailable"]</c> (the same raw snapshot key
    /// <c>KspHost.BuildParts</c> populates for <see cref="PartsUplink"/>'s
    /// power channel: robotics and power are captured by the same sampler
    /// call, so sharing that snapshot key avoids introducing a new sampler
    /// seam), and deployed science still reads
    /// <c>Values["science"]["deployed"]</c> (<c>KspHost.BuildScience</c>'s raw
    /// dict, fed by <c>KspHost.BuildDeployedScience</c>'s global
    /// <c>FlightGlobals.Vessels</c> walk). The KSP-free mapping itself lives in
    /// <see cref="BreakingGroundViewProvider"/>. Only WHICH Uplink registers
    /// the channel sources + commands changed.</para>
    ///
    /// <para>Robotics actuation (servo/rotor set-target/motor/lock/brake/rpm/
    /// torque/reverse) rides here too, unchanged from <see cref="PartsUplink"/>'s
    /// old wiring: <see cref="RoboticsCommandProvider"/>'s <c>Handle*</c> glue
    /// against the <see cref="IRoboticsActuator"/> this uplink is constructed
    /// with (<see cref="KspRoboticsActuator"/> in production,
    /// <c>Sitrep.Host.Tests.FakeRoboticsActuator</c> in tests). Every command
    /// rides <c>delayed: true</c>: actuation of parts ON the craft is an
    /// uplink that rides light-time, the same class as
    /// <c>vessel.control.*</c>.</para>
    ///
    /// <para>When Serenity is absent, <see cref="Register"/> reports
    /// <see cref="Availability.Unavailable"/>, registers empty/false sources
    /// for every declared channel (so a subscriber sees a well-defined
    /// "nothing here" rather than silence indistinguishable from "not
    /// subscribed"), and skips command registration entirely: there is
    /// nothing for a robotics command to actuate without the DLC's part
    /// modules loaded.</para>
    /// </summary>
    [SitrepUplink("breakingGround")]
    public sealed class BreakingGroundUplink : ISitrepUplink
    {
        private readonly IRoboticsActuator _actuator;

        // Set at Register when Serenity isn't installed (the uplink goes
        // inert). Null == available. The check runs at Register only; Health()
        // reads this cached result rather than re-probing every call.
        private string? _unavailableReason;

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
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = BreakingGroundViewProvider.RoboticsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Vessel-sourced telemetry, rides the delay clock like vessel.*.
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
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
                new ChannelDeclaration
                {
                    Topic = BreakingGroundViewProvider.DeployedTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Global across every loaded vessel, but still a
                    // vessel/craft-sourced surface: rides the delay clock.
                    Delay = DelayRole.Delayed,
                },
            },
            // Robotics actuation is an uplink to the craft, so every command
            // rides light-time (delayed: true), like the vessel.control.*
            // commands.
            Commands = new List<CommandDeclaration>
            {
                Command(RoboticsCommandProvider.ServoSetTargetCommand),
                Command(RoboticsCommandProvider.ServoSetMotorCommand),
                Command(RoboticsCommandProvider.ServoSetLockCommand),
                Command(RoboticsCommandProvider.RotorSetRpmLimitCommand),
                Command(RoboticsCommandProvider.RotorSetTorqueLimitCommand),
                Command(RoboticsCommandProvider.RotorSetBrakeCommand),
                Command(RoboticsCommandProvider.RotorSetMotorCommand),
                Command(RoboticsCommandProvider.RotorSetLockCommand),
                Command(RoboticsCommandProvider.RotorReverseCommand),
            },
        };

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>):
        /// Unavailable with the "Serenity not installed" reason when the DLC is
        /// absent (the uplink went inert at Register), else Healthy.</summary>
        public UplinkHealth Health() =>
            _unavailableReason != null
                ? new UplinkHealth(UplinkHealthState.Unavailable, _unavailableReason)
                : UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            if (!ExpansionsLoader.IsExpansionInstalled("Serenity"))
            {
                var reason = "Breaking Ground (Serenity) is not installed";
                Debug.LogWarning("[Gonogo.BreakingGroundUplink] UNAVAILABLE: " + reason + " (all robotics.*/deployed.* channels disabled)");
                _unavailableReason = reason;
                host.SetAvailability(Availability.Unavailable(reason));
                host.AddChannelSource(BreakingGroundViewProvider.RoboticsTopic, _ => null);
                host.AddChannelSource(BreakingGroundViewProvider.RoboticsAvailableTopic, _ => null);
                host.AddChannelSource(BreakingGroundViewProvider.DeployedTopic, _ => null);
                return;
            }

            host.AddChannelSource(BreakingGroundViewProvider.RoboticsTopic, BreakingGroundViewProvider.BuildRobotics);
            host.AddChannelSource(BreakingGroundViewProvider.RoboticsAvailableTopic, BreakingGroundViewProvider.BuildRoboticsAvailable);
            host.AddChannelSource(BreakingGroundViewProvider.DeployedTopic, BreakingGroundViewProvider.BuildDeployed);

            host.AddCommandHandler<ServoSetTargetArgs, CommandResult>(RoboticsCommandProvider.ServoSetTargetCommand, args => RoboticsCommandProvider.HandleServoSetTarget(_actuator, args));
            host.AddCommandHandler<ServoSetEnabledArgs, CommandResult>(RoboticsCommandProvider.ServoSetMotorCommand, args => RoboticsCommandProvider.HandleServoSetMotor(_actuator, args));
            host.AddCommandHandler<ServoSetEnabledArgs, CommandResult>(RoboticsCommandProvider.ServoSetLockCommand, args => RoboticsCommandProvider.HandleServoSetLock(_actuator, args));
            host.AddCommandHandler<RotorSetValueArgs, CommandResult>(RoboticsCommandProvider.RotorSetRpmLimitCommand, args => RoboticsCommandProvider.HandleRotorSetRpmLimit(_actuator, args));
            host.AddCommandHandler<RotorSetValueArgs, CommandResult>(RoboticsCommandProvider.RotorSetTorqueLimitCommand, args => RoboticsCommandProvider.HandleRotorSetTorqueLimit(_actuator, args));
            host.AddCommandHandler<RotorSetValueArgs, CommandResult>(RoboticsCommandProvider.RotorSetBrakeCommand, args => RoboticsCommandProvider.HandleRotorSetBrake(_actuator, args));
            host.AddCommandHandler<ServoSetEnabledArgs, CommandResult>(RoboticsCommandProvider.RotorSetMotorCommand, args => RoboticsCommandProvider.HandleRotorSetMotor(_actuator, args));
            host.AddCommandHandler<ServoSetEnabledArgs, CommandResult>(RoboticsCommandProvider.RotorSetLockCommand, args => RoboticsCommandProvider.HandleRotorSetLock(_actuator, args));
            host.AddCommandHandler<RotorReverseArgs, CommandResult>(RoboticsCommandProvider.RotorReverseCommand, args => RoboticsCommandProvider.HandleRotorReverse(_actuator, args));
        }

        private static CommandDeclaration Command(string command) => new CommandDeclaration
        {
            Command = command,
            Delayed = true,
        };
    }
}
