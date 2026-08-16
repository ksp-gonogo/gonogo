using System;
using System.Collections.Generic;
using CommNet;
using Gonogo.KSP.CommandCentres;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;

namespace Gonogo.KSP.SilenceTracking
{
    /// <summary>
    /// Turns live KSP state into the path geometry
    /// <see cref="PredictedReacquisitionSilenceDeadlinePolicy"/> sweeps: which
    /// station the vessel is trying to reach, which bodies sit between them,
    /// and how big each of those bodies is to a radio wave.
    ///
    /// <para>MAIN THREAD ONLY. Everything here dereferences
    /// <c>FlightGlobals</c>, <c>CommNetHome</c> and the elected comms backend,
    /// which is why it runs inside the capture seam rather than on the
    /// Courier.</para>
    ///
    /// <para><b>Returns null rather than guessing.</b> A null means "no
    /// prediction attempted" and the policy falls back to the orbital-period
    /// deadline, which is always a correct answer. Every case below that
    /// cannot be resolved honestly takes that route: no stations, a chain
    /// deeper than one intermediate body, or a frame self-check that does not
    /// reconcile.</para>
    /// </summary>
    public sealed class KspVisibilityGeometryFactory
    {
        /// <summary>
        /// How far the geometry's own separation may differ from the live
        /// world-space separation before the prediction is abandoned, metres.
        ///
        /// <para>This is the frame self-check the predictor design asks for,
        /// done the one way that needs no world-to-propagation-frame
        /// transform: separation is rotation-invariant, so if the elements,
        /// the patched-conic chain and the station's rotation phase are all
        /// right, the two numbers agree. A wrong <c>rotationAngle</c> sign
        /// misplaces the station by up to a body diameter, so this tolerance
        /// sits well under Kerbin's 1,200 km and well over the drift between
        /// one frame's positions.</para>
        ///
        /// <para>It gates the prediction rather than logging a warning
        /// because a silently-wrong frame produces confident, plausible,
        /// wrong emergence times, which is worse than no prediction at
        /// all.</para>
        /// </summary>
        public const double FrameCheckToleranceMeters = 50_000.0;

        private readonly Func<Kernel> _kernel;
        private readonly Func<IEnumerable<CommNetHome>> _homes;

        public KspVisibilityGeometryFactory(Func<Kernel> kernel, Func<IEnumerable<CommNetHome>> homes = null)
        {
            _kernel = kernel ?? throw new ArgumentNullException(nameof(kernel));
            _homes = homes ?? (() => UnityEngine.Object.FindObjectsOfType<CommNetHome>());
        }

        /// <summary>
        /// Matches <see cref="PredictedReacquisitionSilenceDeadlinePolicy.GeometryFactory"/>.
        /// </summary>
        public IVisibilityGeometry Build(SilenceSample sample, double ut)
        {
            if (sample.Orbit == null || sample.ReferenceBodyIndex == null)
            {
                return null;
            }

            var bodies = FlightGlobals.Bodies;
            if (bodies == null || sample.ReferenceBodyIndex.Value < 0 || sample.ReferenceBodyIndex.Value >= bodies.Count)
            {
                return null;
            }

            var parentBody = bodies[sample.ReferenceBodyIndex.Value];
            var home = NearestHome(parentBody);
            if (home == null)
            {
                return null;
            }

            var stationBody = CommNetHomeAccess.Body(home);
            var comm = CommNetHomeAccess.Comm(home);
            if (stationBody == null || comm == null)
            {
                return null;
            }

            // The frame is centred on the STATION's body, so the vessel's
            // parent is either that body (no intermediate link) or something
            // orbiting it (one link). Anything deeper - a vessel at a moon of
            // another planet, reaching a station on Kerbin - needs the full
            // chain walk, and a two-link approximation of it would be wrong
            // by whole planetary radii rather than gracefully imprecise.
            OrbitElements? parentOrbit = null;
            if (parentBody != stationBody)
            {
                if (parentBody.orbit == null || parentBody.orbit.referenceBody != stationBody)
                {
                    return null;
                }
                parentOrbit = ElementsOf(parentBody.orbit);
            }

            var station = StationOn(stationBody, comm, ut);
            if (station == null)
            {
                return null;
            }

            var occlusion = CommsElection.OcclusionModel(_kernel());
            var geometry = new OrbitToRemoteStationGeometry(
                sample.Orbit.Value,
                parentOrbit,
                station.Value,
                OccludingRadiusOf(occlusion, stationBody),
                OccludingRadiusOf(occlusion, parentBody));

            return ReconcilesWithTheLiveScene(geometry, sample, comm, ut) ? geometry : null;
        }

        /// <summary>
        /// The station whose body is closest to the vessel in the chain: one on
        /// the vessel's own parent if there is one, otherwise any. Deliberately
        /// not "the station the route actually uses" — that is the elected
        /// backend's business and changes hop by hop, while an occultation
        /// prediction only needs a representative endpoint on the right body.
        /// </summary>
        private CommNetHome NearestHome(CelestialBody parentBody)
        {
            CommNetHome fallback = null;
            foreach (var home in _homes())
            {
                if (home == null || CommNetHomeAccess.Comm(home) == null)
                {
                    continue;
                }
                var body = CommNetHomeAccess.Body(home);
                if (body == null)
                {
                    continue;
                }
                if (body == parentBody)
                {
                    return home;
                }
                if (fallback == null || home.isKSC)
                {
                    fallback = home;
                }
            }
            return fallback;
        }

        /// <summary>
        /// A station from the body's geodetic coordinates plus its spin. The
        /// inertial longitude is the body-fixed longitude plus however far the
        /// body has already turned: <c>rotationAngle</c> is the one convention
        /// here that is easy to get wrong silently, which is what the
        /// separation self-check exists to catch.
        /// </summary>
        private static RotatingGroundStation? StationOn(CelestialBody body, CommNode comm, double ut)
        {
            if (!(body.Radius > 0.0) || !(Math.Abs(body.rotationPeriod) > 0.0))
            {
                return null;
            }

            var world = comm.precisePosition;
            var latitude = body.GetLatitude(world);
            var altitude = body.GetAltitude(world);
            var inertialLongitude = body.GetLongitude(world) + body.rotationAngle;

            return RotatingGroundStation.FromLatitudeLongitude(
                latitude,
                inertialLongitude,
                ut,
                body.rotationPeriod,
                body.Radius,
                altitude);
        }

        /// <summary>
        /// Compares the geometry's own vessel-to-station separation at
        /// <paramref name="ut"/> against the live world-space one. Separation
        /// is rotation-invariant, so this checks the elements, the chain and
        /// the station's rotation phase all at once without ever needing to
        /// know how KSP's world axes map onto the propagation frame's.
        /// </summary>
        private static bool ReconcilesWithTheLiveScene(
            IVisibilityGeometry geometry,
            SilenceSample sample,
            CommNode comm,
            double ut)
        {
            var vessel = FindVessel(sample.VesselId);
            if (vessel == null || vessel.orbitDriver == null || vessel.orbitDriver.orbit == null)
            {
                // Nothing to check against: an unloaded vessel with no live
                // position is exactly the case the predictor is for, so this
                // is not a reason to withhold.
                return true;
            }

            var live = (vessel.orbitDriver.orbit.getPositionAtUT(ut) - comm.precisePosition).magnitude;
            var predicted = geometry.SeparationAt(ut);
            return Math.Abs(live - predicted) <= FrameCheckToleranceMeters;
        }

        private static Vessel FindVessel(string vesselId)
        {
            var all = FlightGlobals.Vessels;
            if (all == null)
            {
                return null;
            }
            foreach (var vessel in all)
            {
                if (vessel != null && vessel.id.ToString() == vesselId)
                {
                    return vessel;
                }
            }
            return null;
        }

        private static double OccludingRadiusOf(ICommsOcclusionModel model, CelestialBody body)
        {
            if (body == null)
            {
                return 0.0;
            }
            return model.OccludingRadiusMeters(body.Radius, body.atmosphere);
        }

        private static OrbitElements ElementsOf(Orbit orbit) =>
            new OrbitElements(
                sma: orbit.semiMajorAxis,
                ecc: orbit.eccentricity,
                inc: orbit.inclination,
                lan: orbit.LAN,
                argPe: orbit.argumentOfPeriapsis,
                meanAnomalyAtEpoch: orbit.meanAnomalyAtEpoch,
                epoch: orbit.epoch,
                mu: orbit.referenceBody.gravParameter);
    }
}
