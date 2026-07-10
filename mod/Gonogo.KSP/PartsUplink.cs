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
    /// <para>Read-only capture for this session — no commands. Robotics
    /// actuation (servo/rotor set-target/motor/lock/brake) is a follow-up,
    /// per the master plan's Parts/engineering section.</para>
    /// </summary>
    [SitrepUplink("parts")]
    public sealed class PartsUplink : ISitrepUplink
    {
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
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(PartsViewProvider.PowerTopic, PartsViewProvider.BuildPower);
            host.AddChannelSource(PartsViewProvider.RoboticsTopic, PartsViewProvider.BuildRobotics);
            host.AddChannelSource(PartsViewProvider.RoboticsAvailableTopic, PartsViewProvider.BuildRoboticsAvailable);
        }
    }
}
