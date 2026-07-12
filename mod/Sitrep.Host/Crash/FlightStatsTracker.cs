using System;
using System.Collections.Generic;
using System.Globalization;

namespace Sitrep.Host.Crash
{
    /// <summary>
    /// Accumulates the running per-flight statistics + timestamped event log a
    /// crash record carries (<see cref="FlightStats"/>, <c>events[]</c>) — the
    /// equivalent of the per-flight tracker the Telemachus fork kept. Pure and
    /// KSP-free: the KSP-facing producer reads the live active vessel on the
    /// main thread each sample tick and feeds plain scalars in here, so the
    /// maxima and the flight log exist for a late (re-connecting) subscriber
    /// even when nobody was watching at launch.
    ///
    /// <para>Not thread-safe by design: every entry point is called from the
    /// KSP main thread (the sample capture and every GameEvents callback both
    /// run there), so no locking is needed.</para>
    ///
    /// <para>Distances (<see cref="FlightStats.TotalDistance"/> /
    /// <see cref="FlightStats.GroundDistance"/>) are integrated from the
    /// per-tick surface speed over the elapsed UT — approximate at the sample
    /// cadence, honest enough for a post-crash summary.</para>
    /// </summary>
    public sealed class FlightStatsTracker
    {
        // Guards the distance integral against a warp jump / quickload rewind:
        // a gap larger than this many UT seconds is treated as a discontinuity
        // (skip the integration step for that tick) rather than integrating a
        // huge spurious distance across it.
        private const double MaxIntegrationStepUt = 10.0;

        // Cap the per-vessel event log so a very long flight can't grow it
        // without bound; the oldest entries are dropped first.
        private const int MaxEvents = 200;

        private sealed class State
        {
            public double HighestAltitude;
            public double HighestSpeed;
            public double HighestSpeedOverLand;
            public double HighestGee;
            public double TotalDistance;
            public double GroundDistance;
            public double MissionTime;
            public bool LiftOff;
            public int PartsLost;
            public int KerbalsKilled;
            public double? LastSampleUt;
            public readonly List<string> Events = new List<string>();
        }

        private readonly Dictionary<string, State> _byVessel = new Dictionary<string, State>();

        /// <summary>
        /// Folds one main-thread sample of the active vessel into its running
        /// stats. <paramref name="splashed"/> excludes the sample from
        /// <see cref="FlightStats.HighestSpeedOverLand"/> (a splashdown is not
        /// "over land").
        /// </summary>
        public void Sample(
            string vesselId,
            double ut,
            double altitude,
            double srfSpeed,
            double horizontalSrfSpeed,
            double missionTime,
            double geeForce,
            bool splashed)
        {
            if (string.IsNullOrEmpty(vesselId))
            {
                return;
            }

            var s = GetOrCreate(vesselId);

            if (altitude > s.HighestAltitude) s.HighestAltitude = altitude;
            if (srfSpeed > s.HighestSpeed) s.HighestSpeed = srfSpeed;
            if (!splashed && srfSpeed > s.HighestSpeedOverLand) s.HighestSpeedOverLand = srfSpeed;
            if (geeForce > s.HighestGee) s.HighestGee = geeForce;
            if (missionTime > s.MissionTime) s.MissionTime = missionTime;
            if (missionTime > 0) s.LiftOff = true;

            if (s.LastSampleUt.HasValue)
            {
                var dt = ut - s.LastSampleUt.Value;
                if (dt > 0 && dt <= MaxIntegrationStepUt)
                {
                    s.TotalDistance += srfSpeed * dt;
                    s.GroundDistance += horizontalSrfSpeed * dt;
                }
            }
            s.LastSampleUt = ut;
        }

        /// <summary>Records that <paramref name="count"/> parts died on <paramref name="vesselId"/>.</summary>
        public void RecordPartsLost(string vesselId, int count = 1)
        {
            if (string.IsNullOrEmpty(vesselId) || count <= 0)
            {
                return;
            }
            GetOrCreate(vesselId).PartsLost += count;
        }

        /// <summary>Records that <paramref name="count"/> kerbals died on <paramref name="vesselId"/> during the flight.</summary>
        public void RecordKerbalsKilled(string vesselId, int count = 1)
        {
            if (string.IsNullOrEmpty(vesselId) || count <= 0)
            {
                return;
            }
            GetOrCreate(vesselId).KerbalsKilled += count;
        }

        /// <summary>
        /// Appends a <c>[HH:MM:SS]: message</c> line to the vessel's flight
        /// log, timestamped from mission time. Drops the oldest line once the
        /// log reaches its cap.
        /// </summary>
        public void RecordEvent(string vesselId, double missionTime, string message)
        {
            if (string.IsNullOrEmpty(vesselId))
            {
                return;
            }
            var s = GetOrCreate(vesselId);
            s.Events.Add("[" + FormatMissionClock(missionTime) + "]: " + message);
            if (s.Events.Count > MaxEvents)
            {
                s.Events.RemoveAt(0);
            }
        }

        /// <summary>The vessel's flight-event log, or an empty list if it has none.</summary>
        public IReadOnlyList<string> Events(string vesselId)
        {
            return _byVessel.TryGetValue(vesselId, out var s) ? s.Events : Array.Empty<string>();
        }

        /// <summary>
        /// The vessel's accumulated stats packaged for the crash record. Fills
        /// the crash-context fields (<see cref="FlightStats.MissionEnd"/> true,
        /// <see cref="FlightStats.FlightEndMode"/> catastrophic) that are true
        /// of every published crash. Returns those crash defaults over zeroed
        /// maxima for a vessel that was never sampled.
        /// </summary>
        public FlightStats Snapshot(string vesselId)
        {
            _byVessel.TryGetValue(vesselId, out var s);
            s ??= new State();
            return new FlightStats
            {
                KerbalsKilled = s.KerbalsKilled,
                PartsLost = s.PartsLost,
                FlightEndMode = "CATASTROPHIC_FAILURE",
                HighestSpeedOverLand = s.HighestSpeedOverLand,
                MissionEnd = true,
                HighestGee = s.HighestGee,
                HighestAltitude = s.HighestAltitude,
                TotalDistance = s.TotalDistance,
                MissionTime = s.MissionTime,
                HighestSpeed = s.HighestSpeed,
                GroundDistance = s.GroundDistance,
                LiftOff = s.LiftOff,
            };
        }

        /// <summary>Drops a vessel's accumulated state (e.g. after it is destroyed) to bound memory.</summary>
        public void Forget(string vesselId)
        {
            _byVessel.Remove(vesselId);
        }

        private State GetOrCreate(string vesselId)
        {
            if (!_byVessel.TryGetValue(vesselId, out var s))
            {
                s = new State();
                _byVessel[vesselId] = s;
            }
            return s;
        }

        /// <summary>Formats mission-time seconds as a <c>HH:MM:SS</c> clock (hours un-clamped for very long flights).</summary>
        public static string FormatMissionClock(double missionSeconds)
        {
            if (missionSeconds < 0 || double.IsNaN(missionSeconds) || double.IsInfinity(missionSeconds))
            {
                missionSeconds = 0;
            }
            var total = (long)missionSeconds;
            var hours = total / 3600;
            var minutes = (total % 3600) / 60;
            var seconds = total % 60;
            return hours.ToString("00", CultureInfo.InvariantCulture)
                + ":" + minutes.ToString("00", CultureInfo.InvariantCulture)
                + ":" + seconds.ToString("00", CultureInfo.InvariantCulture);
        }
    }
}
