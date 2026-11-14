using System.Collections.Generic;
using System.Diagnostics;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using UnityEngine;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// The ground's forecast for every craft it loses: when the ground expects
    /// to hear it again, and the deadline past which the home centre may
    /// declare it lost. The <see cref="SilenceTracker"/> works it out from the
    /// game's geometry each tick, and each forecast is handed to the engine
    /// when it changes. Registered from <see cref="CommsCoreUplink.Register"/>,
    /// because the geometry is the comms model's.
    ///
    /// <para>The ground has lost a craft when the craft's route no longer ends at
    /// a ground station, which is what the geometry predicts the return of. A
    /// craft heard only through a crewed craft is lost to the ground.</para>
    ///
    /// <para><b>Ungated.</b> The tracker has to advance every tick whether or not
    /// any client is watching, otherwise whether a craft is declared lost would
    /// depend on which browser tab happens to be open. See
    /// <see cref="CaptureSilenceOnMain"/>.</para>
    /// </summary>
    public sealed class SilenceForecasts
    {
        /// <summary>
        /// Soft cap on the always-run silence capture, sized generously above
        /// a realistic career-scale fleet (a few hundred vessels) sampled at
        /// the one-sample-per-UT-second cadence <c>SampleCadence.IntervalUtAt</c>
        /// keeps at any warp rate.
        /// </summary>
        private static readonly PerfBudget SilenceCaptureBudget = new PerfBudget(
            "SilenceForecasts silence capture", threshold: 2000, windowSec: 1.0, unit: "vessels");

        private ICraftForecastWriter? _forecasts;

        /// <summary>The forecast last handed to the engine for each vessel, so only a change is recorded. Courier thread only.</summary>
        private readonly Dictionary<string, CraftForecast> _forecastSaid = new Dictionary<string, CraftForecast>();

        public SilenceForecasts()
        {
        }

        /// <param name="forecasts">Where the ground's forecasts go, which registration otherwise finds on the host.</param>
        internal SilenceForecasts(ICraftForecastWriter forecasts) => _forecasts = forecasts;

        /// <summary>
        /// Called from <see cref="CommsCoreUplink.Register"/>, on that uplink's
        /// registration pass, so everything here is owned by the <c>comms</c>
        /// uplink for availability and health purposes.
        /// </summary>
        public void RegisterInto(IUplinkHost host)
        {
            SilenceGeometrySink.Bind(host.Kernel);
            _forecasts ??= host as ICraftForecastWriter;

            // Ungated: no subscriptionTopicPrefixes argument, see this
            // class's own doc comment above.
            host.AddSampledSource(CaptureSilenceOnMain, HandleSilenceOnCourier);
        }

        /// <summary>
        /// MAIN-THREAD, ungated capture: reads every <c>FlightGlobals</c>
        /// vessel's live connectivity/orbit/situation, advances
        /// <see cref="SilenceTracker.Tick"/> (mutating the current save's
        /// tracker via <see cref="SilenceTrackerSink"/>), and returns an
        /// immutable snapshot of the touched vessels for the Courier thread
        /// to hand over.
        ///
        /// <para>Snapshots rather than handing out the tracker's own
        /// <see cref="VesselContactState"/> instances: those are reused and
        /// mutated again in place on the very next main-thread tick, which
        /// can run before the Courier thread has processed this one, so a
        /// raw reference crossing the thread boundary here could be read
        /// mid-mutation.</para>
        ///
        /// <para>No tracker bound (e.g. main menu, between scene loads)
        /// simply produces nothing this tick - see
        /// <see cref="SilenceTrackerSink"/>'s own doc comment for why a
        /// quickload/revert cannot leave this pointing at stale state.</para>
        /// </summary>
        internal object? CaptureSilenceOnMain(KspSnapshot? snapshot)
        {
            var tracker = SilenceTrackerSink.Current;
            if (tracker == null)
            {
                SilenceTrace.NoTracker();
                return null;
            }

            var all = FlightGlobals.Vessels;
            if (all == null)
            {
                return null;
            }

            return CaptureSilence(tracker, all, snapshot?.Ut ?? Planetarium.GetUniversalTime());
        }

        /// <summary>One capture of <paramref name="all"/> into <paramref name="tracker"/> at <paramref name="ut"/>.</summary>
        internal object CaptureSilence(SilenceTracker tracker, List<Vessel> all, double ut)
        {
            var config = CommsCoreUplink.SignalDelayConfig;
            var present = new List<SilenceSample>(all.Count);
            foreach (var vessel in all)
            {
                if (vessel == null)
                {
                    continue;
                }
                var orbit = BuildOrbitElements(vessel);
                present.Add(new SilenceSample(
                    vessel.id.ToString(),
                    // In contact means heard by the ground, whichever station; the tracker has no unknown, so a route that could not be read counts as silent.
                    FleetCommsReader.ReachesGround(vessel, config) == true,
                    orbit,
                    RestsOnSurface(vessel),
                    ReferenceBodyIndexOf(vessel)));
            }

            SilenceCaptureBudget.Record(present.Count, ut);
            SilenceTrace.Captured(present.Count, ut);

            var touched = tracker.Tick(present, ut);
            var snapshots = new List<SilenceContactSnapshot>(touched.Count);
            foreach (var state in touched)
            {
                snapshots.Add(new SilenceContactSnapshot
                {
                    VesselId = state.VesselId,
                    State = state.State,
                    SilenceSinceUt = state.SilenceSinceUt,
                    DeadlineUt = state.DeadlineUt,
                    DeadlineBasis = state.DeadlineBasis,
                    PredictedReacquisitionUt = state.PredictedReacquisitionUt,
                    PredictionGraceSec = state.PredictionGraceSec,
                });
            }

            return new SilenceCapture { Ut = ut, Vessels = snapshots, Tracker = tracker };
        }

        /// <summary>COURIER-THREAD handle: hands the engine each forecast the capture changed.</summary>
        internal void HandleSilenceOnCourier(object? captured)
        {
            if (captured is SilenceCapture cap)
            {
                SayForecasts(cap);
            }
        }

        /// <summary>The tracker the forecasts last handed over came from. Courier thread only.</summary>
        private SilenceTracker? _forecastTracker;

        /// <summary>Hands the engine every forecast this capture changed. A new tracker is a new save or a reload, which says every forecast again.</summary>
        private void SayForecasts(SilenceCapture cap)
        {
            if (!ReferenceEquals(cap.Tracker, _forecastTracker))
            {
                _forecastTracker = cap.Tracker;
                _forecastSaid.Clear();
            }
            foreach (var v in cap.Vessels)
            {
                SayForecast(v, cap.Ut);
            }
        }

        /// <summary>
        /// Hands the engine the ground's forecast for one vessel when it has
        /// changed: a deadline while the vessel is silent, none once it is heard
        /// again. A vessel gone from the game has nothing more to forecast.
        /// </summary>
        private void SayForecast(SilenceContactSnapshot v, double ut)
        {
            if (_forecasts == null || v.DeadlineBasis == SilenceDeadlineBasis.Destroyed)
            {
                return;
            }
            var silent = v.State != SilenceState.Nominal;
            var forecast = new CraftForecast(
                CraftStateRecorder.VesselPrefix + v.VesselId,
                ut,
                silent ? v.SilenceSinceUt : null,
                silent ? v.DeadlineUt : null,
                silent ? v.DeadlineBasis : null,
                silent ? v.PredictedReacquisitionUt : null,
                silent ? v.PredictionGraceSec : null);
            if (_forecastSaid.TryGetValue(v.VesselId, out var said) && SameForecast(said, forecast))
            {
                return;
            }
            _forecastSaid[v.VesselId] = forecast;
            _forecasts.RecordCraftForecast(v.VesselId, forecast, ut);
        }

        private static bool SameForecast(CraftForecast a, CraftForecast b) =>
            a.OnsetUt == b.OnsetUt
            && a.DeadlineUt == b.DeadlineUt
            && a.Basis == b.Basis
            && a.PredictedReacquisitionUt == b.PredictedReacquisitionUt
            && a.PredictionGraceSec == b.PredictionGraceSec;

        /// <summary>
        /// Whether the craft sits on its body rather than on a conic, which is the
        /// game's own <c>LandedOrSplashed</c>: a craft in prelaunch is landed too.
        /// The game stops maintaining such a craft's orbit once it is packed, so
        /// its elements describe nothing and a geometry swept from them fails the
        /// frame self-check by the body's radius on every capture.
        /// </summary>
        internal static bool RestsOnSurface(Vessel vessel) => vessel.LandedOrSplashed;

        /// <summary>
        /// The full element set, matching <c>KspHost</c>'s <c>vessel.orbit</c>
        /// extraction field for field.
        ///
        /// <para>Zeroed inc/lan/argPe/meanAnomaly propagate an equatorial
        /// orbit at an arbitrary phase, so every occultation it found would be
        /// for a craft that is not where the game has it. A policy reading
        /// fewer fields costs nothing; a policy reading fabricated ones is
        /// worse than no policy.</para>
        /// </summary>
        private static OrbitElements? BuildOrbitElements(Vessel vessel)
        {
            var orbit = vessel.orbitDriver != null ? vessel.orbitDriver.orbit : null;
            if (orbit == null || orbit.referenceBody == null)
            {
                return null;
            }
            return OrbitElements.FromKspDegrees(
                sma: orbit.semiMajorAxis,
                ecc: orbit.eccentricity,
                incDegrees: orbit.inclination,
                lanDegrees: orbit.LAN,
                argPeDegrees: orbit.argumentOfPeriapsis,
                meanAnomalyAtEpochRadians: orbit.meanAnomalyAtEpoch,
                epoch: orbit.epoch,
                mu: orbit.referenceBody.gravParameter);
        }

        /// <summary>
        /// Index into <c>FlightGlobals.Bodies</c> of the body the vessel's
        /// elements are relative to. The elements alone do not say, and a
        /// predictor cannot choose an occluder without it.
        /// </summary>
        private static int? ReferenceBodyIndexOf(Vessel vessel)
        {
            var body = vessel.orbitDriver != null && vessel.orbitDriver.orbit != null
                ? vessel.orbitDriver.orbit.referenceBody
                : null;
            if (body == null)
            {
                return null;
            }
            var index = FlightGlobals.Bodies.IndexOf(body);
            return index >= 0 ? index : (int?)null;
        }

        private sealed class SilenceCapture
        {
            public double Ut { get; set; }

            /// <summary>The tracker this was captured from. A new one is a new save or a reload, which says every forecast again.</summary>
            public SilenceTracker? Tracker { get; set; }

            /// <summary>The vessels this tick touched.</summary>
            public List<SilenceContactSnapshot> Vessels { get; set; } = new List<SilenceContactSnapshot>();
        }

        /// <summary>
        /// Cross-thread-safe snapshot of one vessel's <see cref="SilenceTracker"/>
        /// state for this tick; see <see cref="CaptureSilenceOnMain"/>'s doc
        /// comment for why this is not the tracker's own
        /// <see cref="VesselContactState"/>.
        /// </summary>
        private sealed class SilenceContactSnapshot
        {
            public string VesselId { get; set; } = string.Empty;
            public SilenceState State { get; set; }
            public double? SilenceSinceUt { get; set; }
            public double? DeadlineUt { get; set; }
            public string? DeadlineBasis { get; set; }
            public double? PredictedReacquisitionUt { get; set; }
            public double? PredictionGraceSec { get; set; }
        }
    }
}
