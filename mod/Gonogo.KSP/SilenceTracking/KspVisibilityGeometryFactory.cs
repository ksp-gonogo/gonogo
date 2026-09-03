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
        private readonly IPropagationProvider _propagator;

        /// <param name="propagator">
        /// The elected propagation capability, which owns the walk from the vessel's
        /// parent to the station's body and so decides whether the path can be
        /// followed at all. Defaults to the two-body vanilla over the LIVE body
        /// table: without one it would decline every cross-body geometry, which is
        /// most of them.
        /// </param>
        public KspVisibilityGeometryFactory(
            Func<Kernel> kernel,
            Func<IEnumerable<CommNetHome>> homes = null,
            IPropagationProvider propagator = null)
        {
            _kernel = kernel ?? throw new ArgumentNullException(nameof(kernel));
            _homes = homes ?? (() => UnityEngine.Object.FindObjectsOfType<CommNetHome>());
            _propagator = propagator ?? new KeplerProvider(KspSystemTable.Current);
        }

        /// <summary>
        /// Matches <see cref="PredictedReacquisitionSilenceDeadlinePolicy.GeometryFactory"/>.
        /// </summary>
        public IVisibilityGeometry Build(SilenceSample sample, double ut)
        {
            // The policy catches whatever this throws and quietly falls back to
            // the orbital-period deadline, so an exception here is completely
            // invisible: no basis change, no log, nothing on the wire. That is
            // the correct behaviour for the policy (a broken factory must not
            // change when a vessel is declared lost) and a diagnostic black hole
            // for everything else, since it makes "threw on line one" look
            // exactly like "worked and found nothing".
            try
            {
                return BuildCore(sample, ut);
            }
            catch (Exception ex)
            {
                SilenceTrace.NoGeometry("threw: " + ex.GetType().Name + ": " + ex.Message);
                return null;
            }
        }

        private IVisibilityGeometry BuildCore(SilenceSample sample, double ut)
        {
            if (sample.Orbit == null || sample.ReferenceBodyIndex == null)
            {
                SilenceTrace.NoGeometry("no orbit or no reference body index");
                return null;
            }

            var bodies = FlightGlobals.Bodies;
            if (bodies == null || sample.ReferenceBodyIndex.Value < 0 || sample.ReferenceBodyIndex.Value >= bodies.Count)
            {
                SilenceTrace.NoGeometry("reference body index out of range");
                return null;
            }

            var parentBody = bodies[sample.ReferenceBodyIndex.Value];
            // These two are DIFFERENT failures behind what used to be one
            // message, and the trace de-dupes by message: "no homes exist" then
            // masked "homes exist but none resolved to a body" for the rest of
            // the session, because the second never printed. The first is
            // transient (CommNet is not built on the opening tick); the second
            // is a real bug in body resolution. They must not look alike.
            CelestialBody stationBody;
            int unresolvedHomes;
            List<CommNode> stationNodes;
            var comm = NearestHomeNode(parentBody, bodies, out stationBody, out unresolvedHomes, out stationNodes);
            if (comm == null)
            {
                SilenceTrace.NoGeometry(unresolvedHomes > 0
                    ? "found " + unresolvedHomes + " home node(s) but could not resolve a body under any of them"
                    : "no home node in the live CommNet");
                return null;
            }
            if (stationBody == null)
            {
                SilenceTrace.NoGeometry("home node found but no body resolved under it");
                return null;
            }

            // Walk the patched-conic chain between the station's body and the
            // vessel's parent: up to their common ancestor, then down. A craft
            // at a moon of another planet is several links from a Kerbin
            // station, and describing it with one element set is wrong by whole
            // planetary radii within minutes.
            var occlusion = CommsElection.OcclusionModel(_kernel());
            var stationBodyIndex = bodies.IndexOf(stationBody);
            var vessel = PropagationTarget.Vessel(
                sample.VesselId, sample.ReferenceBodyIndex.Value, sample.Orbit);
            var frame = PropagationFrame.CentredOn(stationBodyIndex);
            var occluders = OccludersBetween(stationBodyIndex, sample.ReferenceBodyIndex.Value, occlusion);
            if (occluders == null || !_propagator.CanPropagate(vessel, frame, ut, ut))
            {
                SilenceTrace.NoGeometry("no propagatable path between "
                    + parentBody.bodyName + " and " + stationBody.bodyName);
                return null;
            }

            SilenceTrace.Chain(parentBody.bodyName, stationBody.bodyName, occluders.Count);

            double longitudeOffset;
            if (!StationLongitudeCalibration.TryGet(stationBodyIndex, out longitudeOffset))
            {
                if (!TryCalibrate(sample, stationBody, comm, occlusion, stationBodyIndex, out longitudeOffset))
                {
                    SilenceTrace.NoGeometry("longitude not calibrated yet for " + stationBody.bodyName);
                    return null;
                }
            }

            // Every station on the body, not one of them. A single ground
            // station is below the horizon for a large fraction of the body's
            // rotation, and treating that as a comms outage invents a blackout
            // the real network never has: measured live as a 2104 s prediction
            // against a 795 s truth, the excess being the wait for one station
            // to come back around rather than for the moon to clear.
            // The chosen node goes FIRST, because the frame self-check measures
            // against comm.precisePosition and compares that with the
            // geometry's own first station. Any other order compares two
            // different points on the planet and reports their separation - up
            // to a body diameter - as frame error.
            var stations = new List<RotatingGroundStation>();
            var chosenStation = StationOn(stationBody, comm, longitudeOffset);
            if (chosenStation != null) stations.Add(chosenStation.Value);
            foreach (var node in stationNodes)
            {
                if (ReferenceEquals(node, comm)) continue;
                var on = StationOn(stationBody, node, longitudeOffset);
                if (on != null) stations.Add(on.Value);
            }
            if (stations.Count == 0)
            {
                SilenceTrace.NoGeometry("station body has no radius or no spin");
                return null;
            }
            SilenceTrace.StationNetwork(stationBody.bodyName, stations.Count);

            var geometry = new OrbitToRemoteStationGeometry(
                vessel,
                frame,
                occluders,
                stations,
                OccludingRadiusOf(occlusion, stationBody),
                _propagator);

            return ReconcilesWithTheLiveScene(geometry, sample, comm, ut) ? geometry : null;
        }

        /// <summary>
        /// A ground station to predict against: one on the vessel's own parent
        /// body if there is one, otherwise any. Deliberately not "the station
        /// the route actually uses", that is the elected backend's business
        /// and changes hop by hop, while an occultation prediction only needs a
        /// representative endpoint on the right body.
        ///
        /// <para>Reads the LIVE CommNet graph rather than
        /// <c>FindObjectsOfType&lt;CommNetHome&gt;()</c>. With a network-replacing backend
        /// that scene search returns nothing at all, which is exactly how this
        /// silently produced no prediction for every vessel, while the network
        /// it actually routes over is full of home nodes; <c>comms.path</c> was
        /// reporting hops to "Crater Rim Station" the whole time. Home nodes
        /// carry their own <c>precisePosition</c>, so the CommNetHome
        /// MonoBehaviour was never needed for this.</para>
        /// </summary>
        private CommNode NearestHomeNode(
            CelestialBody parentBody,
            IList<CelestialBody> bodies,
            out CelestialBody stationBody,
            out int unresolvedHomes,
            out List<CommNode> nodesOnStationBody)
        {
            stationBody = null;
            nodesOnStationBody = new List<CommNode>();
            CommNode fallback = null;
            CelestialBody fallbackBody = null;
            var byBody = new Dictionary<CelestialBody, List<CommNode>>();

            int pathHomes, sceneHomes;
            var homes = HomeNodes(out pathHomes, out sceneHomes);
            SilenceTrace.HomeSearch(pathHomes, sceneHomes, homes.Count);
            unresolvedHomes = 0;
            CommNode chosen = null;

            foreach (var node in homes)
            {
                var body = BodyUnder(node.precisePosition, bodies);
                if (body == null)
                {
                    // Counted, not just skipped: a node whose body cannot be
                    // resolved leaves this method returning null, which used to
                    // be indistinguishable from "there are no home nodes at
                    // all" - the transient first-tick state. One message for two
                    // causes, and the change-detector then suppressed the
                    // permanent one behind the transient one for the rest of the
                    // session.
                    unresolvedHomes++;
                    continue;
                }
                List<CommNode> onBody;
                if (!byBody.TryGetValue(body, out onBody))
                {
                    onBody = new List<CommNode>();
                    byBody[body] = onBody;
                }
                onBody.Add(node);

                if (body == parentBody)
                {
                    stationBody = body;
                    nodesOnStationBody = onBody;
                    chosen = node;
                }
                if (fallback == null)
                {
                    fallback = node;
                    fallbackBody = body;
                }
            }

            if (chosen != null)
            {
                return chosen;
            }

            stationBody = fallbackBody;
            if (fallbackBody != null)
            {
                byBody.TryGetValue(fallbackBody, out nodesOnStationBody);
                nodesOnStationBody = nodesOnStationBody ?? new List<CommNode>();
            }
            return fallback;
        }

        /// <summary>
        /// The bodies that can come between the station's body and the vessel's
        /// parent, ordered nearest-the-station first. Null when there is no path at
        /// all, which means the two are in different systems or the hierarchy is
        /// malformed.
        ///
        /// <para>Whether that path can be FOLLOWED is a separate question, and it
        /// is the provider's: it owns the walk now, so it is the only thing that can
        /// answer for a physics other than two-body. This method's whole job is
        /// translating the live occlusion model into the radius lookup
        /// <see cref="PatchedConicChain"/> asks for.</para>
        /// </summary>
        private List<OccludingBody> OccludersBetween(
            int stationBodyIndex,
            int vesselParentIndex,
            ICommsOcclusionModel occlusion)
        {
            var bodies = FlightGlobals.Bodies;
            if (bodies == null)
            {
                return null;
            }

            return PatchedConicChain.OccludersBetween(
                stationBodyIndex,
                vesselParentIndex,
                KspSystemTable.Current(),
                index => index >= 0 && index < bodies.Count
                    ? OccludingRadiusOf(occlusion, bodies[index])
                    : 0.0);
        }

        /// <summary>
        /// Home nodes, from the LIVE routed control path first and the
        /// <see cref="CommNetHome"/> scene objects second.
        ///
        /// <para>The scene search alone was the bug: with a network-replacing backend elected
        /// <c>FindObjectsOfType&lt;CommNetHome&gt;()</c> returns nothing, so
        /// every vessel silently got no prediction, while <c>comms.path</c>
        /// was reporting hops to "Crater Rim Station" the whole time. The
        /// control path is the read the comms backend already makes
        /// successfully on this install, and its links carry home
        /// <see cref="CommNode"/>s with their own <c>precisePosition</c>, which
        /// is all the geometry needs.</para>
        ///
        /// <para>The path yields the stations the ACTIVE vessel routes
        /// through, not every station in the game. For an occultation
        /// prediction that is enough, a representative endpoint on the right
        /// body is what the geometry wants, but it is a real limit: a silent
        /// vessel at a body the active craft never talks to gets no
        /// prediction, and falls back to the orbital-period deadline.</para>
        /// </summary>
        /// <summary>
        /// Every home node reachable from the live scene.
        ///
        /// <para>Scans EVERY vessel's connection, not just the active one's. The
        /// active vessel is the one most likely to be out of contact, it is the
        /// craft being watched go dark, and a disconnected vessel has an EMPTY
        /// ControlPath, so keying on it meant the predictor lost its stations at
        /// exactly the moment it needed them. Measured live: activeVessel=True,
        /// connection=True, pathLinks=0.</para>
        ///
        /// <para>Every comms backend reads stock <c>CommNode</c>s from the same
        /// control paths (a backend replaces the network, not the node type),
        /// so this is backend-agnostic without branching on which mod is
        /// installed. The <see cref="CommNetHome"/> scene objects are a second
        /// source for a stock install whose network has not been built yet.</para>
        ///
        /// <para>Returns a LIST, not a lazy sequence. The counts are traced by
        /// the caller: a diagnostic at the end of an iterator only runs if the
        /// consumer drains it, so an early <c>return</c> silently skipped the
        /// one line that explains why nothing was found.</para>
        /// </summary>
        private List<CommNode> HomeNodes(out int pathHomes, out int sceneHomes)
        {
            var found = new List<CommNode>();
            var seen = new HashSet<string>(System.StringComparer.Ordinal);
            pathHomes = 0;
            sceneHomes = 0;

            var vessels = FlightGlobals.Vessels;
            if (vessels != null)
            {
                foreach (var vessel in vessels)
                {
                    var path = vessel != null && vessel.connection != null ? vessel.connection.ControlPath : null;
                    if (path == null) continue;
                    foreach (var link in path)
                    {
                        if (link == null) continue;
                        foreach (var node in new[] { link.a, link.b })
                        {
                            if (node == null || !node.isHome) continue;
                            if (!seen.Add(node.precisePosition.ToString())) continue;
                            pathHomes++;
                            found.Add(node);
                        }
                    }
                }
            }

            foreach (var home in _homes())
            {
                var comm = home != null ? CommNetHomeAccess.Comm(home) : null;
                if (comm == null) continue;
                if (!seen.Add(comm.precisePosition.ToString())) continue;
                sceneHomes++;
                found.Add(comm);
            }

            return found;
        }

        /// <summary>
        /// Which body a home node sits on, by smallest altitude above the
        /// surface. A home node knows its world position but not its body, and
        /// the answer is unambiguous: stations sit ON a surface, so the body
        /// whose surface they are nearest is the one they are on.
        /// </summary>
        private static CelestialBody BodyUnder(Vector3d worldPosition, IList<CelestialBody> bodies)
        {
            CelestialBody best = null;
            var bestAltitude = double.MaxValue;
            foreach (var body in bodies)
            {
                if (body == null || !(body.Radius > 0.0))
                {
                    continue;
                }
                var altitude = Math.Abs((worldPosition - body.position).magnitude - body.Radius);
                if (altitude < bestAltitude)
                {
                    bestAltitude = altitude;
                    best = body;
                }
            }
            return best;
        }

        /// <summary>
        /// A station from the body's geodetic coordinates plus its spin. The
        /// inertial longitude is the body-fixed longitude plus however far the
        /// body has already turned: <c>rotationAngle</c> is the one convention
        /// here that is easy to get wrong silently, which is what the
        /// separation self-check exists to catch.
        /// </summary>
        private static RotatingGroundStation? StationOn(CelestialBody body, CommNode comm, double longitudeOffsetDeg)
        {
            if (!(body.Radius > 0.0) || !(Math.Abs(body.rotationPeriod) > 0.0))
            {
                return null;
            }

            var world = comm.precisePosition;
            var latitude = body.GetLatitude(world);
            var altitude = body.GetAltitude(world);
            var inertialLongitude = body.GetLongitude(world) + body.rotationAngle + longitudeOffsetDeg;

            // The offset is measured, not asserted: see
            // StationLongitudeCalibration for why.
            //
            // The reference UT is NOW, not the caller's ut.
            //
            // Both inputs are live quantities: precisePosition is where the
            // station is at this instant, and rotationAngle is recomputed from
            // Planetarium.GetUniversalTime() every frame. Stamping a now-phase
            // with a past reference UT time-shifts the station's entire
            // trajectory by (now - ut), and the sweep origin CAN be far in the
            // past - a deadline upgrade evaluates from the silence onset, hours
            // earlier. Every other input to this geometry is epoch-anchored
            // (OrbitElements carries epoch + meanAnomalyAtEpoch), so the station
            // was the only term that could drift, and it drifted silently.
            return RotatingGroundStation.FromLatitudeLongitude(
                latitude,
                inertialLongitude,
                Planetarium.GetUniversalTime(),
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
        private bool ReconcilesWithTheLiveScene(
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

            // Compare at NOW, both sides. comm.precisePosition is a live
            // reading and cannot be evaluated at any other time, so measuring
            // the vessel at the sweep origin instead put the two endpoints at
            // different instants and the check reported the vessel's own motion
            // between them as frame error. On the upgrade path that origin is
            // the silence ONSET, so the gap was unbounded, and a craft in a
            // one-hour Minmus orbit accumulated hundreds of kilometres of
            // "residual" while the geometry was in fact correct.
            //
            // This was the valve firing on its own inconsistency: predictions
            // were being withheld by a bug in the check rather than by a bug in
            // what it checks.
            var now = Planetarium.GetUniversalTime();
            var live = (vessel.orbitDriver.orbit.getPositionAtUT(now) - comm.precisePosition).magnitude;
            var predicted = geometry.SeparationAt(now);
            var residual = Math.Abs(live - predicted);
            if (residual > FrameCheckToleranceMeters)
            {
                DecomposeResidual(sample, vessel, now);
                SilenceTrace.FrameCheckFailed(live, predicted, residual);
                return false;
            }
            return true;
        }

        /// <summary>
        /// Solves for this body's longitude offset against the live scene, by
        /// minimising the same residual the frame self-check reports: the gap
        /// between the geometry's own vessel-to-station separation and the
        /// world-space one. Coarse pass then fine, so the whole circle costs a
        /// few hundred cheap evaluations, once per body.
        ///
        /// <para>Needs a LOADED vessel to measure against, so it returns false
        /// until one is available. That is the correct order of events anyway:
        /// there is nothing to calibrate against in a scene with no live craft,
        /// and a prediction withheld for a few ticks costs nothing.</para>
        /// </summary>
        private bool TryCalibrate(
            SilenceSample sample,
            CelestialBody stationBody,
            CommNode comm,
            ICommsOcclusionModel occlusion,
            int stationBodyIndex,
            out double offsetDegrees)
        {
            offsetDegrees = 0.0;

            // Prefer a reference orbiting the STATION's own body, so the chain
            // is empty and the solve isolates the one unknown it is for.
            //
            // Measured both ways on the live save: a Kerbin-orbiting reference
            // converged to 373 m of 2,467 km, while a Minmus one bottomed out at
            // 116 km of 46,327 km and was rejected. The difference is the chain
            // link's own propagation error leaking into the fit, which then
            // shifts the longitude to compensate - a good fit to the wrong
            // model. One unknown at a time.
            var reference = FindVesselOrbiting(stationBody) ?? FindAnyLoadedVessel();
            if (reference == null || reference.orbitDriver == null || reference.orbitDriver.orbit == null)
            {
                SilenceTrace.Calibration("no reference vessel to measure against for " + stationBody.bodyName);
                return false;
            }

            var refBody = reference.orbitDriver.orbit.referenceBody;
            var refIndex = refBody != null ? FlightGlobals.Bodies.IndexOf(refBody) : -1;
            if (refIndex < 0)
            {
                SilenceTrace.Calibration("reference vessel " + reference.vesselName + " has no known parent body");
                return false;
            }

            var now = Planetarium.GetUniversalTime();
            var refOccluders = OccludersBetween(stationBodyIndex, refIndex, occlusion);
            var refTarget = PropagationTarget.Vessel(
                reference.id.ToString(), refIndex, ElementsOf(reference.orbitDriver.orbit));
            var frame = PropagationFrame.CentredOn(stationBodyIndex);
            if (refOccluders == null || !_propagator.CanPropagate(refTarget, frame, now, now))
            {
                SilenceTrace.Calibration("no propagatable path from reference at " + refBody.bodyName
                    + " to station at " + stationBody.bodyName);
                return false;
            }

            var live = (reference.orbitDriver.orbit.getPositionAtUT(now) - comm.precisePosition).magnitude;

            var best = double.MaxValue;
            var bestOffset = 0.0;
            for (var coarse = -180.0; coarse < 180.0; coarse += 2.0)
            {
                var r = ResidualAt(coarse, refTarget, frame, refOccluders, stationBody, comm, occlusion, now, live);
                if (r < best) { best = r; bestOffset = coarse; }
            }
            for (var fine = bestOffset - 2.0; fine <= bestOffset + 2.0; fine += 0.1)
            {
                var r = ResidualAt(fine, refTarget, frame, refOccluders, stationBody, comm, occlusion, now, live);
                if (r < best) { best = r; bestOffset = fine; }
            }

            // Only accept a solve that actually reconciles. A minimum that is
            // still far off is not a calibration, it is the least-bad of a set
            // of wrong answers, and adopting it would hand the sweep a station
            // in the wrong place with no further warning.
            if (best > FrameCheckToleranceMeters)
            {
                SilenceTrace.Calibration("FAILED for " + stationBody.bodyName
                    + ": best offset " + bestOffset.ToString("F1") + " deg still leaves "
                    + best.ToString("F0") + "m of " + live.ToString("F0") + "m");
                return false;
            }

            StationLongitudeCalibration.Set(stationBodyIndex, bestOffset);
            offsetDegrees = bestOffset;
            SilenceTrace.Calibration(stationBody.bodyName + " longitude offset "
                + bestOffset.ToString("F1") + " deg, residual " + best.ToString("F0")
                + "m of " + live.ToString("F0") + "m");
            return true;
        }

        private double ResidualAt(
            double offsetDeg,
            PropagationTarget refTarget,
            PropagationFrame frame,
            List<OccludingBody> refOccluders,
            CelestialBody stationBody,
            CommNode comm,
            ICommsOcclusionModel occlusion,
            double now,
            double live)
        {
            var station = StationOn(stationBody, comm, offsetDeg);
            if (station == null)
            {
                return double.MaxValue;
            }
            var geometry = new OrbitToRemoteStationGeometry(
                refTarget,
                frame,
                refOccluders,
                station.Value,
                OccludingRadiusOf(occlusion, stationBody),
                _propagator);
            return Math.Abs(live - geometry.SeparationAt(now));
        }

        /// <summary>
        /// Any vessel orbiting <paramref name="body"/>, loaded or not.
        ///
        /// <para>Being unloaded is no obstacle: <c>getPositionAtUT</c> is the
        /// same propagation KSP itself uses for an on-rails craft, and the
        /// world-space position it yields is exactly what the calibration
        /// compares against. Requiring a LOADED reference found nothing at all
        /// on a real save - only the active vessel is loaded, and it was at
        /// Minmus - which sent the solve back to a one-link chain and the
        /// polluted fit this preference exists to avoid.</para>
        /// </summary>
        private static Vessel FindVesselOrbiting(CelestialBody body)
        {
            var all = FlightGlobals.Vessels;
            if (all == null) return null;
            foreach (var v in all)
            {
                if (v == null || v.orbitDriver == null || v.orbitDriver.orbit == null) continue;
                if (v.orbitDriver.orbit.referenceBody != body) continue;
                if (!IsPropagatable(v.orbitDriver.orbit)) continue;
                return v;
            }
            return null;
        }

        /// <summary>
        /// Whether <see cref="KeplerProvider"/> can solve this orbit at all.
        ///
        /// <para>A save is full of things it cannot: debris on escape
        /// trajectories, and anything else with <c>ecc &gt;= 1</c>. Picking one
        /// as the calibration reference threw deep inside the solver, the policy
        /// swallowed the throw, and the predictor went silent for the entire
        /// session with no trace - which is exactly what happened here, twice,
        /// for two different reasons.</para>
        /// </summary>
        private static bool IsPropagatable(Orbit orbit) =>
            orbit.eccentricity < 1.0
            && orbit.semiMajorAxis > 0.0
            && orbit.referenceBody != null
            && orbit.referenceBody.gravParameter > 0.0;

        private static Vessel FindAnyLoadedVessel()
        {
            // Deliberately NOT ActiveVesselScope: this wants ANY vessel with a
            // propagatable orbit to calibrate against, and falls through to the whole
            // roster below when the first candidate will not do. It names no scope.
            var active = FlightGlobals.ActiveVessel;
            if (active != null && active.orbitDriver != null && active.orbitDriver.orbit != null
                && IsPropagatable(active.orbitDriver.orbit))
            {
                return active;
            }
            var all = FlightGlobals.Vessels;
            if (all == null) return null;
            foreach (var v in all)
            {
                if (v != null && v.loaded && v.orbitDriver != null && v.orbitDriver.orbit != null
                    && IsPropagatable(v.orbitDriver.orbit))
                {
                    return v;
                }
            }
            return null;
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

        /// <summary>
        /// Reports each propagated term beside the live value it should match,
        /// so a wrong answer says WHICH element set is wrong rather than only
        /// that the total does not reconcile.
        /// </summary>
        private void DecomposeResidual(SilenceSample sample, Vessel vessel, double now)
        {
            try
            {
                // The ELECTED provider, not a fresh vanilla. A diagnostic that reports
                // what a different propagator would have said is a diagnostic about the
                // wrong subsystem, and this one runs precisely when the numbers already
                // disagree.
                var liveVessel = vessel.orbitDriver.orbit.getRelativePositionAtUT(now).magnitude;
                var predictedVessel = _propagator
                    .Solve(SilenceSampleTarget.Of(sample), now).Position.Magnitude();

                var bodies = FlightGlobals.Bodies;
                var parent = vessel.orbitDriver.orbit.referenceBody;
                var up = parent != null && parent.orbit != null && parent.orbit.referenceBody != null
                    && parent.orbit.referenceBody != parent
                    ? parent.orbit
                    : null;
                var liveLink = up != null ? up.getRelativePositionAtUT(now).magnitude : 0.0;
                var predictedLink = 0.0;
                if (up != null && bodies != null)
                {
                    var parentIndex = bodies.IndexOf(parent);
                    var grandParentIndex = bodies.IndexOf(up.referenceBody);
                    predictedLink = _propagator.Solve(
                        PropagationTarget.Body(parentIndex),
                        PropagationFrame.CentredOn(grandParentIndex),
                        now).Position.Magnitude();
                }

                SilenceTrace.Decompose(liveVessel, predictedVessel, liveLink, predictedLink);
            }
            catch (Exception ex)
            {
                SilenceTrace.NoGeometry("decompose threw: " + ex.Message);
            }
        }

        private static OrbitElements ElementsOf(Orbit orbit) =>
            OrbitElements.FromKspDegrees(
                sma: orbit.semiMajorAxis,
                ecc: orbit.eccentricity,
                incDegrees: orbit.inclination,
                lanDegrees: orbit.LAN,
                argPeDegrees: orbit.argumentOfPeriapsis,
                meanAnomalyAtEpochRadians: orbit.meanAnomalyAtEpoch,
                epoch: orbit.epoch,
                mu: orbit.referenceBody.gravParameter);
    }
}
