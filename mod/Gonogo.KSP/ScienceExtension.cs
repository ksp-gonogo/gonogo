using System.Collections.Generic;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>science.*</c> capture surface — added THIS session so a live
    /// recording carries onboard experiment/container data, science-lab
    /// processing state, and Breaking Ground deployed-experiment status
    /// alongside <c>career.*</c>. Mirrors <see cref="CareerExtension"/>'s
    /// retrofit shape exactly: this class is thin KSP-adjacent wiring; the
    /// actual mapping lives in the KSP-free <c>Sitrep.Host</c> assembly
    /// (<see cref="ScienceViewProvider"/>), headlessly testable there. No
    /// <see cref="ISnapshotSampler"/> is registered because <c>KspHost.Sample</c>
    /// already populates the raw <c>"science"</c> snapshot key (guarded to
    /// "there's an active vessel" — see <c>KspHost.BuildScience</c>'s doc
    /// comment).
    ///
    /// <para>Three channels, one per sub-group, rather than one combined
    /// topic — experiments/lab/deployed genuinely change at different
    /// cadences (an experiment's data changes on run/collect; a lab
    /// processes continuously; deployed science is placed once and then
    /// mostly idles), and ScienceOfficer/ScienceBench/DeployedScience each
    /// only need one of the three.</para>
    ///
    /// <para>Read-only capture for this session — no commands. Science
    /// actuation (deploy/reset/transmit/collect) is a follow-up.</para>
    /// </summary>
    public sealed class ScienceExtension : ISitrepExtension
    {
        public ExtensionManifest Manifest { get; } = new ExtensionManifest
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
                    // as changed" cadence CareerExtension/SystemExtension
                    // already use for structured, not-every-tick data.
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

        public void Register(IExtensionHost host)
        {
            host.AddChannelSource(ScienceViewProvider.ExperimentsTopic, ScienceViewProvider.BuildExperiments);
            host.AddChannelSource(ScienceViewProvider.LabTopic, ScienceViewProvider.BuildLab);
            host.AddChannelSource(ScienceViewProvider.DeployedTopic, ScienceViewProvider.BuildDeployed);
        }
    }
}
