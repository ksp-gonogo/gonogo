using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Sitrep.Host.Propulsion;

namespace Gonogo.KSP
{
    /// <summary>
    /// Keeps every craft other than the active one reporting into its lane (see
    /// <see cref="ICraftLaneHost"/>), so a switch to it shows what its light has
    /// already brought instead of waiting a whole delay. A craft loaded within
    /// physics range reports its live readings; a craft on rails reports what the
    /// game holds of it, one craft at a time. How often, which craft and which
    /// readings are <see cref="CraftLanePolicy"/>'s to say.
    ///
    /// <para>Each craft is read by the same vessel-entry walk as the active craft,
    /// so a lane carries the same payloads. A group the game cannot read for a
    /// craft (anything off the parts of a craft on rails) is left out and that
    /// topic gets no reading, which a screen shows as no reading rather than
    /// zero.</para>
    ///
    /// <para>Part of the fleet scope, attached by <see cref="FleetChannels"/>, so it
    /// adds no Uplink of its own to the roster.</para>
    /// </summary>
    internal sealed class CraftLaneFeed
    {
        private static readonly PerfBudget LoadedBuildBudget = new PerfBudget(
            "CraftLaneFeed loaded craft read", threshold: 10, windowSec: 1.0, unit: "craft");

        private static readonly PerfBudget OnRailsBuildBudget = new PerfBudget(
            "CraftLaneFeed on-rails craft read", threshold: 5, windowSec: 1.0, unit: "craft");

        private ICraftLaneHost? _lanes;
        private IUplinkHost? _host;
        private IVesselJourneyWriter? _journeyWriter;

        // Main-thread-only: the UT each craft was last read at, and its own thrust history.
        private readonly Dictionary<Guid, double> _lastReadUt = new Dictionary<Guid, double>();
        private readonly Dictionary<Guid, ThrustObserver> _thrust = new Dictionary<Guid, ThrustObserver>();
        private int _onRailsCursor;

        /// <summary>Attaches the feed to <paramref name="host"/>; a host that keeps no lanes is left alone.</summary>
        public void Register(IUplinkHost host)
        {
            _host = host;
            _lanes = host as ICraftLaneHost;
            _journeyWriter = host as IVesselJourneyWriter;
            if (_lanes == null)
            {
                return;
            }
            host.AddSampledSource(CaptureOnMain, HandleOnCourier);
        }

        /// <summary>MAIN-THREAD: the craft due a reading this tick, each read whole.</summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            if (!HighLogic.LoadedSceneIsFlight || !FlightGlobals.ready || FlightGlobals.Vessels == null)
            {
                return null;
            }
            var active = FlightGlobals.ActiveVessel;
            if (active == null)
            {
                return null;
            }
            var ut = snapshot != null ? snapshot.Ut : Planetarium.GetUniversalTime();
            var config = CommsCoreUplink.SignalDelayConfig;
            var reads = new List<CraftRead>();

            var policy = CraftLanePolicy.Current;
            var activeAt = active.GetWorldPos3D();
            var loaded = FlightGlobals.Vessels
                .Where(v => v != null && v != active && v.loaded && Reports(v))
                .OrderBy(v => (v.GetWorldPos3D() - activeAt).sqrMagnitude)
                .Take(policy.MaxLoadedCraft);
            foreach (var vessel in loaded)
            {
                if (Due(vessel, ut, policy.LoadedIntervalUt))
                {
                    LoadedBuildBudget.Record(1, ut);
                    Read(vessel, vessel.packed ? CraftBand.Packed : CraftBand.Unpacked, ut, config, policy, reads);
                }
            }

            var onRails = FlightGlobals.Vessels.Where(v => v != null && v != active && !v.loaded && Reports(v)).ToList();
            for (var tried = 0; tried < onRails.Count; tried++)
            {
                _onRailsCursor = (_onRailsCursor + 1) % onRails.Count;
                var vessel = onRails[_onRailsCursor];
                if (!Due(vessel, ut, policy.OnRailsIntervalUt))
                {
                    continue;
                }
                OnRailsBuildBudget.Record(1, ut);
                Read(vessel, CraftBand.OnRails, ut, config, policy, reads);
                break;
            }

            ForgetGoneCraft();
            return reads.Count == 0 ? null : new LaneCapture
            {
                Ut = ut,
                Bodies = snapshot != null && snapshot.Values.TryGetValue("bodies", out var bodies) ? bodies : null,
                Reads = reads,
            };
        }

        private static bool Reports(Vessel vessel) => CraftLanePolicy.Current.Reports(vessel.vesselType.ToString());

        /* A read UT ahead of the clock belongs to a timeline a load abandoned, so it counts as due. */
        private bool Due(Vessel vessel, double ut, double interval) =>
            !_lastReadUt.TryGetValue(vessel.id, out var last) || ut - last >= interval || ut < last;

        private void Read(Vessel vessel, CraftBand band, double ut, SignalDelayConfig config, CraftLanePolicy policy, List<CraftRead> reads)
        {
            _lastReadUt[vessel.id] = ut;
            if (!_thrust.TryGetValue(vessel.id, out var thrust))
            {
                thrust = new ThrustObserver();
                _thrust[vessel.id] = thrust;
            }
            try
            {
                var (oneWay, _) = FleetCommsReader.ReadVessel(vessel, config);
                Dictionary<string, object?>? savedTanks = null;
                if (policy.HoldsSavedTanks(band))
                {
                    var tanks = new Dictionary<string, object?>();
                    FleetChannels.AddSavedTanks(vessel, tanks);
                    savedTanks = TrackingStationVesselResourcesBuilder.Build(tanks);
                }
                reads.Add(new CraftRead
                {
                    Id = vessel.id.ToString(),
                    Entry = policy.Filter(band, KspHost.BuildLaneVesselEntry(vessel, thrust, ut)),
                    SavedTanks = savedTanks,
                    OneWaySeconds = oneWay,
                    Journey = FleetCommsReader.ReadVesselJourney(vessel, config),
                });
            }
            catch (Exception ex)
            {
                // Nothing rather than half a craft: a reading built from a part of the walk would be taken for the whole.
                GonogoLog.WarnLimited("craft lane read failed for vessel " + vessel.id + ", omitting", ex);
            }
        }

        private void ForgetGoneCraft()
        {
            if (_lastReadUt.Count <= FlightGlobals.Vessels.Count)
            {
                return;
            }
            var present = new HashSet<Guid>(FlightGlobals.Vessels.Where(v => v != null).Select(v => v.id));
            foreach (var id in _lastReadUt.Keys.Where(id => !present.Contains(id)).ToList())
            {
                _lastReadUt.Remove(id);
                _thrust.Remove(id);
            }
        }

        /// <summary>COURIER-THREAD: times each craft read, then keeps its readings in its lane.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not LaneCapture capture || _lanes == null)
            {
                return;
            }
            foreach (var read in capture.Reads)
            {
                // Its delay first, so its readings are timed by its own light rather than held as a craft never heard.
                if (read.OneWaySeconds.HasValue)
                {
                    _host?.SetVesselDelay(read.Id, read.OneWaySeconds.Value);
                    if (read.Journey != null)
                    {
                        _journeyWriter?.SetVesselJourney(read.Id, read.Journey);
                    }
                }
                var values = new Dictionary<string, object?> { ["vessel"] = read.Entry };
                if (capture.Bodies != null)
                {
                    values["bodies"] = capture.Bodies;
                }
                _lanes.WriteCraftSnapshot(read.Id, new KspSnapshot { Ut = capture.Ut, Values = values });
                if (read.SavedTanks != null)
                {
                    _lanes.HoldCraftFact(read.Id, ChannelEngine.SavedTanksFact, read.SavedTanks, capture.Ut);
                }
            }
        }

        private sealed class LaneCapture
        {
            public double Ut { get; set; }
            public object? Bodies { get; set; }
            public List<CraftRead> Reads { get; set; } = new List<CraftRead>();
        }

        private sealed class CraftRead
        {
            public string Id { get; set; } = string.Empty;
            public Dictionary<string, object?> Entry { get; set; } = new Dictionary<string, object?>();
            public object? SavedTanks { get; set; }
            public double? OneWaySeconds { get; set; }
            public Journey? Journey { get; set; }
        }
    }
}
