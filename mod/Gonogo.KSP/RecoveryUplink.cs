using System;
using System.Collections.Generic;
using System.Reflection;
using KSP.UI.Screens;
using KSP.UI.Screens.SpaceCenter.MissionSummaryDialog;
using Sitrep.Contract;
using Sitrep.Host.Recovery;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The recovery event producer: hooks KSP's stock post-recovery
    /// notification, builds the single "last notable recovery" record,
    /// applies the source-side relevance filter, and publishes it on the
    /// <c>recovery.lastSummary</c> / <c>recovery.hasRecent</c>
    /// <see cref="Delivery.ReliableOrdered"/> channels. Mirrors
    /// <c>CrashUplink</c> structurally: same channel shape, same
    /// filter-at-source rule, same KSP-facing/KSP-free split with
    /// <see cref="Sitrep.Host.Recovery.RecoveryPayload"/>.
    ///
    /// <para><b>Hook choice: <see cref="GameEvents.onVesselRecoveryProcessingComplete"/>,
    /// not <see cref="GameEvents.OnVesselRecoveryRequested"/> or
    /// <see cref="GameEvents.onVesselRecovered"/>:</b> decompile-confirmed
    /// (<c>KSP.UI.Screens.MissionRecoveryDialog</c>) that stock KSP's own
    /// recovery-summary UI computes every earned/total funds/science/
    /// reputation figure and the itemized part/resource/science/crew
    /// breakdown into a <see cref="MissionRecoveryDialog"/> instance BEFORE
    /// firing <c>onVesselRecoveryProcessingComplete(ProtoVessel, MissionRecoveryDialog,
    /// float)</c>: reusing that computation is the whole point (the same
    /// "reuse the read, don't duplicate it" discipline <c>CareerViewProvider</c>
    /// follows for economy totals). <c>OnVesselRecoveryRequested</c> is the
    /// pre-recovery REQUEST (nothing computed yet: see
    /// <c>KspFlightOpsActuator.Recover</c>, the actuator that fires it).
    /// <c>onVesselRecovered(ProtoVessel, bool)</c> is a bare completion
    /// notification with no earned/total figures at all.</para>
    ///
    /// <para><b>Breakdown arrays: best-effort via reflection, judgement call:</b>
    /// <see cref="MissionRecoveryDialog"/>'s per-item widget lists
    /// (<c>scienceWidgets</c>/<c>partWidgets</c>/<c>resourceWidgets</c>/
    /// <c>crewWidgets</c>) are PRIVATE fields on a UI `MonoBehaviour`, there
    /// is no public API surface for the itemized breakdown, only the
    /// aggregate totals (all public). Every other decompile-confirmed read in
    /// this codebase sticks to public API; this is a deliberate, narrow
    /// exception, isolated to <see cref="ReadWidgetList{T}"/> below and
    /// wrapped defensively: a field-name mismatch after a future KSP update
    /// degrades to an empty breakdown list (still-correct totals, less
    /// detail), never a crash or a dropped publish. A public-API alternative
    /// may exist and would be a straightforward follow-up swap if found.</para>
    ///
    /// <para><b>A save that awards nothing (Sandbox):</b> stock raises its summary
    /// event with no dialog for a crewless loaded craft, and builds a dialog with
    /// nothing in it for the rest, so there is no summary to reuse. The record is
    /// built from <see cref="GameEvents.onVesselRecovered"/> instead, which fires
    /// first and unconditionally, from what the craft itself holds. Funds and
    /// science are left absent: a save with no funds has no balance of zero.</para>
    /// </summary>
    [SitrepUplink("recovery")]
    public sealed class RecoveryUplink : ISitrepUplink
    {
        // A recovery can raise both of the events hooked below; the first one in wins.
        private const double DedupWindowUt = 2.0;

        private readonly Dictionary<string, double> _lastPublishedUt = new Dictionary<string, double>();
        private IChannelPublisher? _lastSummary;
        private IChannelPublisher? _hasRecent;
        private bool _subscribed;

        private static ChannelDeclaration Channel(string topic, Delivery delivery) => new ChannelDeclaration
        {
            Requires = Requirement.None,
            Topic = topic,
            // A recovery is a flight-ending event at the vessel, so it is
            // Delayed (rides the light-time reveal clock): behaviourally
            // moot at delay 0, and correct once a comms uplink is elected.
            // Mirrors CrashUplink.Channel exactly.
            Delay = DelayRole.Delayed,
            Delivery = delivery,
            // Keyframe-on-change with a coarse interval: a recovery is a
            // discrete one-shot, so the change-gate + reliable lane deliver
            // each new value and replay the last one to a late subscriber.
            Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
        };

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "recovery",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                Channel(RecoveryTopics.LastSummaryTopic, Delivery.ReliableOrdered),
                Channel(RecoveryTopics.HasRecentTopic, Delivery.ReliableOrdered),
            },
        };

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>): a plain
        /// channel uplink is Healthy once it has registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            _lastSummary = host.Publisher(RecoveryTopics.LastSummaryTopic);
            _hasRecent = host.Publisher(RecoveryTopics.HasRecentTopic);

            HookGameEvents();
        }

        private void HookGameEvents()
        {
            if (_subscribed)
            {
                return;
            }
            _subscribed = true;

            GameEvents.onVesselRecoveryProcessingComplete.Add(OnRecoveryComplete);
            GameEvents.onVesselRecovered.Add(OnVesselRecovered);
            // The hook lives for the whole process: Register runs once, before the
            // main menu, and recovery can happen after any flight.
        }

        /// <summary>
        /// True in a save with no funds, no reputation and no science, the only kind in which
        /// stock hands the summary event no dialog worth reading.
        /// </summary>
        private static bool SaveAwardsNothing() =>
            Funding.Instance == null && Reputation.Instance == null && ResearchAndDevelopment.Instance == null;

        private bool AlreadyPublished(string vesselId, double ut)
        {
            if (_lastPublishedUt.TryGetValue(vesselId, out var previous) && Math.Abs(ut - previous) <= DedupWindowUt)
            {
                return true;
            }
            _lastPublishedUt[vesselId] = ut;
            return false;
        }

        /// <summary>
        /// MAIN-THREAD: publishes the record for a recovery in a save that awards nothing.
        /// A recovery in any other save is left to <see cref="OnRecoveryComplete"/>, and a
        /// quick one (stock clearing the launch site for a new launch) is not a recovery
        /// the operator made.
        /// </summary>
        private void OnVesselRecovered(ProtoVessel vessel, bool quick)
        {
            try
            {
                if (vessel == null || quick || !SaveAwardsNothing())
                {
                    return;
                }

                var vesselType = vessel.vesselType.ToString();
                if (!RecoveryPayload.ShouldPublish(vesselType))
                {
                    return;
                }

                var ut = Planetarium.GetUniversalTime();
                if (AlreadyPublished(vessel.vesselID.ToString(), ut))
                {
                    return;
                }

                Publish(BuildUnawardedCapture(vessel, vesselType, ut), ut);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] recovery capture failed: " + ex);
            }
        }

        private void Publish(RecoveryCapture capture, double ut)
        {
            _lastSummary?.Publish(RecoveryPayload.Build(capture), ut);
            _hasRecent?.Publish(RecoveryPayload.ToWire(new RecoveryRecent { Recent = true }), ut);
        }

        private static RecoveryCapture BuildUnawardedCapture(ProtoVessel vessel, string vesselType, double ut)
        {
            var parts = new List<KeyValuePair<string, string>>();
            if (vessel.protoPartSnapshots != null)
            {
                foreach (var snapshot in vessel.protoPartSnapshots)
                {
                    if (snapshot == null)
                    {
                        continue;
                    }
                    var name = snapshot.partInfo?.name ?? snapshot.partName ?? "";
                    parts.Add(new KeyValuePair<string, string>(name, snapshot.partInfo?.title ?? name));
                }
            }

            var crew = new List<RecoveryCrewItem>();
            foreach (var member in vessel.GetVesselCrew())
            {
                crew.Add(new RecoveryCrewItem
                {
                    Name = member.name ?? "",
                    Trait = member.trait ?? "",
                    IsTourist = member.type == ProtoCrewMember.KerbalType.Tourist,
                    NewLevel = member.experienceLevel,
                });
            }

            var location = string.IsNullOrEmpty(vessel.displaylandedAt) ? vessel.landedAt : vessel.displaylandedAt;
            return RecoveryPayload.Unawarded(ut, vessel.vesselName ?? "", vesselType, location ?? "", parts, crew);
        }

        /// <summary>
        /// MAIN-THREAD recovery handler: filters debris, assembles the
        /// record from the already-computed <see cref="MissionRecoveryDialog"/>,
        /// and publishes it. <see cref="IChannelPublisher.Publish"/> is
        /// main-thread-safe (it hands off to the engine job queue), so
        /// publishing straight from a GameEvents callback is correct, same
        /// as <c>CrashUplink.HandleCrash</c>.
        /// </summary>
        private void OnRecoveryComplete(ProtoVessel vessel, MissionRecoveryDialog dialog, float recoveryPercent)
        {
            try
            {
                if (vessel == null || dialog == null || SaveAwardsNothing())
                {
                    return;
                }

                var vesselType = vessel.vesselType.ToString();
                if (!RecoveryPayload.ShouldPublish(vesselType))
                {
                    return;
                }

                var ut = Planetarium.GetUniversalTime();
                Publish(BuildCapture(vessel, dialog, vesselType, ut), ut);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] recovery capture failed: " + ex);
            }
        }

        private static RecoveryCapture BuildCapture(ProtoVessel vessel, MissionRecoveryDialog dialog, string vesselType, double ut)
        {
            return new RecoveryCapture
            {
                CapturedAtUt = ut,
                VesselName = vessel.vesselName ?? "",
                VesselType = vesselType,
                RecoveryLocation = dialog.recoveryLocation ?? "",
                RecoveryFactor = dialog.recoveryFactor ?? "",
                ScienceEarned = ResearchAndDevelopment.Instance == null ? (double?)null : dialog.scienceEarned,
                TotalScience = ResearchAndDevelopment.Instance == null ? (double?)null : dialog.totalScience,
                FundsEarned = Funding.Instance == null ? (double?)null : dialog.fundsEarned,
                TotalFunds = Funding.Instance == null ? (double?)null : dialog.totalFunds,
                ReputationEarned = dialog.reputationEarned,
                TotalReputation = dialog.totalReputation,
                DisplayReputation = dialog.displayReputation,
                ScienceBreakdown = ReadScienceBreakdown(dialog),
                PartBreakdown = ReadPartBreakdown(dialog),
                ResourceBreakdown = ReadResourceBreakdown(dialog),
                CrewBreakdown = ReadCrewBreakdown(dialog),
            };
        }

        // ── Breakdown extraction: see class doc comment's "judgement call" note ──

        private static List<RecoveryScienceItem> ReadScienceBreakdown(MissionRecoveryDialog dialog)
        {
            var result = new List<RecoveryScienceItem>();
            foreach (var widget in ReadWidgetList<ScienceSubjectWidget>(dialog, "scienceWidgets"))
            {
                if (widget?.subject == null)
                {
                    continue;
                }
                result.Add(new RecoveryScienceItem
                {
                    SubjectId = widget.subject.id ?? "",
                    SubjectTitle = widget.subject.title ?? "",
                    DataGathered = widget.dataGathered,
                    ScienceAmount = widget.scienceAmount,
                });
            }
            return result;
        }

        private static List<RecoveryPartItem> ReadPartBreakdown(MissionRecoveryDialog dialog)
        {
            var result = new List<RecoveryPartItem>();
            foreach (var widget in ReadWidgetList<PartWidget>(dialog, "partWidgets"))
            {
                if (widget == null)
                {
                    continue;
                }
                result.Add(new RecoveryPartItem
                {
                    PartName = widget.partInfo?.name ?? "",
                    PartTitle = widget.partInfo?.title ?? "",
                    Count = widget.count,
                    PartValue = widget.partValue,
                    ResourcesValue = widget.resourcesValue,
                    TotalValue = widget.totalValue,
                });
            }
            return result;
        }

        private static List<RecoveryResourceItem> ReadResourceBreakdown(MissionRecoveryDialog dialog)
        {
            var result = new List<RecoveryResourceItem>();
            foreach (var widget in ReadWidgetList<ResourceWidget>(dialog, "resourceWidgets"))
            {
                if (widget == null)
                {
                    continue;
                }
                result.Add(new RecoveryResourceItem
                {
                    ResourceName = widget.rscDef?.name ?? "",
                    Amount = widget.amount,
                    UnitValue = widget.unitValue,
                    TotalValue = widget.totalValue,
                });
            }
            return result;
        }

        private static List<RecoveryCrewItem> ReadCrewBreakdown(MissionRecoveryDialog dialog)
        {
            var result = new List<RecoveryCrewItem>();
            foreach (var widget in ReadWidgetList<CrewWidget>(dialog, "crewWidgets"))
            {
                if (widget?.crew == null)
                {
                    continue;
                }
                result.Add(new RecoveryCrewItem
                {
                    Name = widget.crew.name ?? "",
                    Trait = widget.crew.trait ?? "",
                    IsTourist = widget.isTourist,
                    XpGained = widget.xpGained,
                    LevelsGained = widget.levelsGained,
                    NewLevel = widget.newLevel,
                });
            }
            return result;
        }

        /// <summary>
        /// Reads a private <c>List&lt;T&gt;</c> instance field off
        /// <paramref name="dialog"/> by name via reflection: see the class
        /// doc comment's "breakdown arrays" note for why. Defensive by
        /// design: any failure (field renamed/retyped by a future KSP
        /// update, reflection denied, etc.) is swallowed and yields an empty
        /// list rather than throwing, so a breakdown-extraction miss can
        /// never take down the whole recovery publish, the summary totals
        /// (all public-API reads) still go out.
        /// </summary>
        private static List<T> ReadWidgetList<T>(MissionRecoveryDialog dialog, string fieldName)
        {
            try
            {
                var field = typeof(MissionRecoveryDialog).GetField(
                    fieldName, BindingFlags.NonPublic | BindingFlags.Instance);
                if (field?.GetValue(dialog) is List<T> list)
                {
                    return list;
                }
            }
            catch (Exception)
            {
                // Fall through to the empty list below.
            }
            return new List<T>();
        }
    }
}
