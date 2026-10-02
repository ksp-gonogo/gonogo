using System.Collections.Generic;
using Expansions;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The bundled, DLC-gated Making History uplink: owns the
    /// <c>missions.active</c> channel, the running mission's name, phase,
    /// objectives and score. Shipped IN the core mod DLL like
    /// <see cref="BreakingGroundUplink"/> (auto-discovered, not a separate
    /// installable package) and inert when Making History is not installed,
    /// gated on <c>ExpansionsLoader.IsExpansionInstalled("MakingHistory")</c>.
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
        // Set at Register when the expansion is absent. Null == available.
        private string? _unavailableReason;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "makingHistory",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
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

        public UplinkHealth Health() =>
            _unavailableReason != null
                ? new UplinkHealth(UplinkHealthState.Unavailable, _unavailableReason)
                : UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            if (!ExpansionsLoader.IsExpansionInstalled("MakingHistory"))
            {
                var reason = "Making History is not installed";
                Debug.LogWarning("[Gonogo.MakingHistoryUplink] UNAVAILABLE: " + reason + " (missions.active disabled)");
                _unavailableReason = reason;
                host.SetAvailability(Availability.Unavailable(reason));
                host.AddChannelSource(MakingHistoryViewProvider.MissionTopic, _ => null);
                return;
            }

            host.AddChannelSource(MakingHistoryViewProvider.MissionTopic, MakingHistoryViewProvider.BuildMissionStatus);
        }
    }
}
