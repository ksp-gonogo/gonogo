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
    /// <para>Read-only capture for this session — no commands. Science
    /// actuation (deploy/reset/transmit/collect) is a follow-up.</para>
    /// </summary>
    [SitrepUplink("science")]
    public sealed class ScienceUplink : ISitrepUplink
    {
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
        };

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(ScienceViewProvider.ExperimentsTopic, ScienceViewProvider.BuildExperiments);
            host.AddChannelSource(ScienceViewProvider.InstrumentsTopic, ScienceViewProvider.BuildInstruments);
            host.AddChannelSource(ScienceViewProvider.LabTopic, ScienceViewProvider.BuildLab);
            host.AddChannelSource(ScienceViewProvider.DeployedTopic, ScienceViewProvider.BuildDeployed);
            host.AddChannelSource(ScienceViewProvider.SensorsTopic, ScienceViewProvider.BuildSensors);
        }
    }
}
