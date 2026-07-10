using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>science.*</c> capture surface — added THIS session so a live
    /// recording carries onboard experiment/container data, science-lab
    /// processing state, and Breaking Ground deployed-experiment status
    /// alongside <c>career.*</c>. Mirrors <see cref="CareerUplink"/>'s
    /// retrofit shape exactly: this class is thin KSP-adjacent wiring; the
    /// actual mapping lives in the KSP-free <c>Sitrep.Host</c> assembly
    /// (<see cref="ScienceViewProvider"/>), headlessly testable there. No
    /// <see cref="ISnapshotSampler"/> is registered because <c>KspHost.Sample</c>
    /// already populates the raw <c>"science"</c> snapshot key (guarded to
    /// "there's an active vessel" — see <c>KspHost.BuildScience</c>'s doc
    /// comment).
    ///
    /// <para>One channel per science sub-group, rather than one combined
    /// topic — experiments/lab/deployed genuinely change at different
    /// cadences (an experiment's data changes on run/collect; a lab
    /// processes continuously; deployed science is placed once and then
    /// mostly idles), and ScienceOfficer/ScienceBench/DeployedScience each
    /// only need one of the three.</para>
    ///
    /// <para>Experiment actuation rides here too: <c>science.experiment.deploy</c>
    /// and <c>science.experiment.transmit</c> (<see cref="ScienceCommandProvider"/>'s
    /// <c>Handle*</c> glue against the <see cref="IScienceActuator"/> this
    /// uplink is constructed with — <see cref="KspScienceActuator"/> in
    /// production). Both are genuine uplinks to the craft (they actuate an
    /// experiment ON the vessel), so both are declared <c>delayed: true</c>.
    /// Reset/collect remain a follow-up.</para>
    /// </summary>
    [SitrepUplink("science")]
    public sealed class ScienceUplink : ISitrepUplink
    {
        private readonly IScienceActuator _actuator;

        public ScienceUplink(IScienceActuator actuator)
        {
            _actuator = actuator;
        }

        /// <summary>
        /// The discovery-required parameterless constructor (see
        /// <c>Sitrep.Host.UplinkDiscovery</c>: a discoverable Uplink resolves
        /// its own real dependency rather than taking it as a discovery-time
        /// argument). Builds its own <see cref="KspScienceActuator"/>, mirroring
        /// <see cref="VesselUplink"/>'s parameterless-ctor shape.
        /// </summary>
        public ScienceUplink() : this(new KspScienceActuator())
        {
        }

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "science",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.ExperimentsTopic,
                    Delivery = Delivery.LossyLatest,
                    // Same 30s-keyframe + "fresh Dictionary every call reads
                    // as changed" cadence CareerUplink/SystemUplink
                    // already use for structured, not-every-tick data.
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit — vessel/experiment-sourced, rides the delay clock.
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.InstrumentsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit — active-vessel instrument inventory, rides the delay clock.
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.LabTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit — same as ExperimentsTopic above.
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.DeployedTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit — same as ExperimentsTopic above.
                    Delay = DelayRole.Delayed,
                },
                new ChannelDeclaration
                {
                    Topic = ScienceViewProvider.SensorsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit — active-vessel environmental-sensor
                    // readouts, rides the delay clock like the rest of science.*.
                    Delay = DelayRole.Delayed,
                },
            },
            // Experiment actuation is a genuine uplink to the craft (deploy runs
            // an experiment ON the vessel; transmit drives its onboard
            // transmitter), so both ride the same light-time delay every other
            // vessel actuation does — delayed: true. See VesselUplink's command
            // table for the full delay-classification rule.
            Commands = new List<CommandDeclaration>
            {
                Command(ScienceCommandProvider.DeployCommand, delayed: true),
                Command(ScienceCommandProvider.TransmitCommand, delayed: true),
            },
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(ScienceViewProvider.ExperimentsTopic, ScienceViewProvider.BuildExperiments);
            host.AddChannelSource(ScienceViewProvider.InstrumentsTopic, ScienceViewProvider.BuildInstruments);
            host.AddChannelSource(ScienceViewProvider.LabTopic, ScienceViewProvider.BuildLab);
            host.AddChannelSource(ScienceViewProvider.DeployedTopic, ScienceViewProvider.BuildDeployed);
            host.AddChannelSource(ScienceViewProvider.SensorsTopic, ScienceViewProvider.BuildSensors);

            host.AddCommandHandler<ExperimentActionArgs, CommandResult>(ScienceCommandProvider.DeployCommand, args => ScienceCommandProvider.HandleDeploy(_actuator, args));
            host.AddCommandHandler<ExperimentActionArgs, CommandResult>(ScienceCommandProvider.TransmitCommand, args => ScienceCommandProvider.HandleTransmit(_actuator, args));
        }

        private static CommandDeclaration Command(string command, bool delayed) => new CommandDeclaration
        {
            Command = command,
            Delayed = delayed,
        };
    }
}
