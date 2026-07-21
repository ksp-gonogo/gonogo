using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>parts.*</c> capture surface — added THIS session so a live
    /// recording carries power production (solar/battery/fuel-cell/
    /// alternator) and Breaking Ground robotics (rotor/hinge/piston servo)
    /// state alongside <c>career.*</c>/<c>science.*</c>. Mirrors
    /// <see cref="CareerUplink"/>'s retrofit shape; the actual mapping
    /// lives in <see cref="PartsViewProvider"/>. No <see cref="ISnapshotSampler"/>
    /// is registered — <c>KspHost.Sample</c> already populates the raw
    /// <c>"parts"</c> snapshot key (guarded to "there's an active vessel" —
    /// see <c>KspHost.BuildParts</c>'s doc comment).
    ///
    /// <para>Three channels — power and robotics change at different cadences
    /// and are consumed by different widgets (PowerSystems vs.
    /// RoboticsConsole/RotorTachometer), plus a tiny robotics.available
    /// wrapper the robotics widgets read to distinguish "no robotic parts on
    /// this craft" from "no active vessel / no data".</para>
    ///
    /// <para>Alongside the read channels, this uplink registers the Breaking
    /// Ground robotics COMMANDS — the servo/rotor set-target/motor/lock/
    /// brake/rpm/torque/reverse actuations (<see cref="RoboticsCommandProvider"/>'s
    /// <c>Handle*</c> glue against the <see cref="IRoboticsActuator"/> this
    /// uplink is constructed with — <see cref="KspRoboticsActuator"/> in
    /// production, <c>Sitrep.Host.Tests.FakeRoboticsActuator</c> in tests).
    /// They ride <c>delayed: true</c> (actuation of parts ON the craft is an
    /// uplink that rides light-time, the same class as <c>vessel.control.*</c>).</para>
    /// </summary>
    [SitrepUplink("parts")]
    public sealed class PartsUplink : ISitrepUplink
    {
        private readonly IRoboticsActuator _actuator;

        public PartsUplink(IRoboticsActuator actuator)
        {
            _actuator = actuator;
        }

        /// <summary>
        /// The discovery-required parameterless constructor (see
        /// <c>Sitrep.Host.UplinkDiscovery</c>: a discoverable Uplink resolves
        /// its own dependencies rather than taking them as discovery-time
        /// arguments). Builds the real <see cref="KspRoboticsActuator"/>,
        /// mirroring <see cref="VesselUplink"/>'s two-constructor shape.
        /// </summary>
        public PartsUplink() : this(new KspRoboticsActuator())
        {
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "parts",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = PartsViewProvider.PowerTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit — part/vessel-sourced telemetry, rides the delay clock like vessel.*.
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    Topic = PartsViewProvider.RoboticsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit — same as PowerTopic above.
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    // "Does THIS vessel have any Breaking Ground servos" — a
                    // single { available } wrapper. Vessel-derived (parts on
                    // the active vessel), so it rides the delay clock like the
                    // other parts.* channels — NOT the ground-side DLC fact.
                    Topic = PartsViewProvider.RoboticsAvailableTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
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

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>): a plain
        /// channel uplink is Healthy once it has registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(PartsViewProvider.PowerTopic, PartsViewProvider.BuildPower);
            host.AddChannelSource(PartsViewProvider.RoboticsTopic, PartsViewProvider.BuildRobotics);
            host.AddChannelSource(PartsViewProvider.RoboticsAvailableTopic, PartsViewProvider.BuildRoboticsAvailable);

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
