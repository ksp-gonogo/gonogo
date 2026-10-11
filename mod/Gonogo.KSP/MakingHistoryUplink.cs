using System.Collections.Generic;
using Expansions;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The bundled, DLC-gated Making History uplink: owns the
    /// <c>missions.active</c> channel, the running mission's name, phase,
    /// objectives and score. Shipped IN the core mod DLL like
    /// <see cref="BreakingGroundUplink"/> (auto-discovered, not a separate
    /// installable package). Its health reads
    /// <c>ExpansionsLoader.IsExpansionInstalled("MakingHistory")</c> live, and
    /// the channel carries nothing while no mission is loaded.
    ///
    /// <para>The raw read is <see cref="MissionCapture"/> (the
    /// <c>Values["missions"]</c> group <c>KspHost.Sample</c> records); the
    /// KSP-free mapping is <see cref="MakingHistoryViewProvider"/>. Nothing
    /// here has been run in game.</para>
    ///
    /// <para>Read-only: it declares no commands. The channel rides
    /// <see cref="DelayRole.Delayed"/> and held at home, because the mission is the
    /// home command's record rather than a reading off a craft.</para>
    /// </summary>
    [SitrepUplink("makingHistory")]
    public sealed class MakingHistoryUplink : ISitrepUplink
    {
        private readonly ExpansionHealth _expansion = new ExpansionHealth(
            () => ExpansionsLoader.IsExpansionInstalled("MakingHistory"),
            "Making History is not installed");

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "makingHistory",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Requires = Requirement.None,
                    Topic = MakingHistoryViewProvider.MissionTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // The mission is the home command's record, held in one place like the career ledger,
                    // so each vantage learns a change after its own delay to home.
                    Delay = DelayRole.Delayed,
                    HeldAtHome = true,
                    // No mission is a fact, not a gap: leaving a mission has to clear the Objectives widget.
                    AbsenceIsData = true,
                },
            },
            Commands = new List<CommandDeclaration>(),
        };

        public UplinkHealth Health() => _expansion.Report();

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(MakingHistoryViewProvider.MissionTopic, MakingHistoryViewProvider.BuildMissionStatus);
        }
    }
}
