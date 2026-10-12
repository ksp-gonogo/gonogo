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
    /// <para>Main thread only. Everything here dereferences
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
        /// the patched-conic chain and the station's place on its body are all
        /// right, the two numbers agree. A station placed with the wrong heading
        /// is misplaced by up to a body diameter, so this tolerance sits well
        /// under Kerbin's 1,200 km and well over the drift between one frame's
        /// positions.</para>
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
        /// followed at all. Defaults to the two-body vanilla over the live body
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
            // These two are DIFFERENT failures and must not share one message:
            // the trace de-dupes by message, so if "no homes exist" and "homes
            // exist but none resolved to a body" were the same string, the
            // second would be masked for the rest of the session once the
            // first had printed. The first is transient (CommNet is not built
            // on the opening tick); the second is a real bug in body
            // resolution. They must not look alike.
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

            FrameFit frameFit;
            if (!TryFitFrame(stationBody, bodies, out frameFit))
            {
                SilenceTrace.NoGeometry("world frame not fitted yet for " + stationBody.bodyName);
                return null;
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
            // Reach rides alongside each station rather than being taken once,
            // because it is a fact about a PAIR: RSS/RealAntennas fly a dozen
            // stations that do not share an antenna, so one limit for all of
            // them would either shorten the good ones or flatter the weak.
            var stations = new List<RotatingGroundStation>();
            var reachLimits = new List<double?>();
            var vesselNode = VesselNode(sample.VesselId);
            var reachModelId = CommsReachModels.UnknownModelId;
            var chosenStation = StationOn(stationBody, comm, frameFit);
            if (chosenStation != null)
            {
                stations.Add(chosenStation.Value);
                var reach = ReachTo(vesselNode, comm);
                reachModelId = reach.ModelId;
                reachLimits.Add(reach.MaxRangeMeters);
            }
            foreach (var node in stationNodes)
            {
                if (ReferenceEquals(node, comm)) continue;
                var on = StationOn(stationBody, node, frameFit);
                if (on != null)
                {
                    stations.Add(on.Value);
                    reachLimits.Add(ReachTo(vesselNode, node).MaxRangeMeters);
                }
            }
            if (stations.Count == 0)
            {
                SilenceTrace.NoGeometry("station body has no radius or no spin");
                return null;
            }
            SilenceTrace.StationNetwork(stationBody.bodyName, stations.Count);
            SilenceTrace.Reach(reachModelId, reachLimits);

            var geometry = new OrbitToRemoteStationGeometry(
                vessel,
                frame,
                occluders,
                stations,
                OccludingRadiusOf(occlusion, stationBody),
                _propagator,
                reachLimits);

            return ReconcilesWithTheLiveScene(geometry, sample, comm, stationBody, ut) ? geometry : null;
        }

        /// <summary>
        /// A ground station to predict against: one on the vessel's own parent
        /// body if there is one, otherwise any. Deliberately not "the station
        /// the route actually uses", that is the elected backend's business
        /// and changes hop by hop, while an occultation prediction only needs a
        /// representative endpoint on the right body.
        ///
        /// <para>Reads the live CommNet graph first, and the
        /// <c>FindObjectsOfType&lt;CommNetHome&gt;()</c> scene objects second (see
        /// <see cref="HomeNodes"/>). The graph is the read that always works:
        /// home nodes carry their own <c>precisePosition</c>, so the CommNetHome
        /// MonoBehaviour is never needed for the geometry.</para>
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
        /// <para>Whether that path can be followed is a separate question, and it
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
        /// Home nodes, from the live routed control path first and the
        /// <see cref="CommNetHome"/> scene objects second.
        ///
        /// <para>Searching only the active vessel's path was the bug, not the
        /// scene search: it produced no prediction for every vessel while
        /// <c>comms.path</c> was reporting hops to "Crater Rim Station" the whole
        /// time. Both halves work under a network-replacing backend.
        /// <c>FindObjectsOfType&lt;CommNetHome&gt;()</c> returns plenty under
        /// RealAntennas, whose <c>RACommNetHome</c> derives from
        /// <see cref="CommNetHome"/> and sets the two protected fields
        /// <c>CommNetHomeAccess</c> reflects for; on one RSS/RA save the two
        /// reads together find 13 stations, 3-4 off live control paths and 9-10
        /// off the scene objects, deduplicated by position. (An earlier comment
        /// here asserted the scene search returned nothing under RA. It was
        /// inferred from the absence of a result and retracted in 68443eed7;
        /// nothing in the assemblies supports it.)</para>
        ///
        /// <para>The control path goes first all the same, because it is the read
        /// the elected comms backend is already making successfully, and its
        /// links carry home <see cref="CommNode"/>s with their own
        /// <c>precisePosition</c>, which is all the geometry needs.</para>
        ///
        /// <para>The path yields the stations the active vessel routes
        /// through, not every station in the game. For an occultation
        /// prediction that is enough, a representative endpoint on the right
        /// body is what the geometry wants, but it is a real limit: a silent
        /// vessel at a body the active craft never talks to gets no
        /// prediction, and falls back to the orbital-period deadline.</para>
        /// </summary>
        /// <summary>
        /// Every home node reachable from the live scene.
        ///
        /// <para>Scans every vessel's connection, not just the active one's. The
        /// active vessel is the one most likely to be out of contact, it is the
        /// craft being watched go dark, and a disconnected vessel has an empty
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
        /// <para>Returns a list, not a lazy sequence. The counts are traced by
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
        /// the answer is unambiguous: stations sit on a surface, so the body
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
        /// A station from where the game says the node is, turned into the
        /// propagation frame, plus the body's spin.
        /// </summary>
        private static RotatingGroundStation? StationOn(CelestialBody body, CommNode comm, FrameFit fit) =>
            SurfacePointAt(body, comm.precisePosition, fit);

        /// <summary>
        /// The surface point under <paramref name="node"/> on <paramref name="body"/>,
        /// placed in the propagation frame. The frame's heading belongs to the
        /// body, not to any one point on it, so any node on the surface will do:
        /// a landed craft places a body with no ground station. Null until the
        /// body's frame can be fitted. Main thread.
        /// </summary>
        internal RotatingGroundStation? SurfacePointOf(CelestialBody body, CommNode node)
        {
            var bodies = FlightGlobals.Bodies;
            if (bodies == null || node == null)
            {
                return null;
            }
            FrameFit fit;
            if (!TryFitFrame(body, bodies, out fit))
            {
                return null;
            }
            return SurfacePointAt(body, node.precisePosition, fit);
        }

        private static RotatingGroundStation? SurfacePointAt(CelestialBody body, Vector3d world, FrameFit fit)
        {
            if (!(body.Radius > 0.0) || !(Math.Abs(body.rotationPeriod) > 0.0))
            {
                return null;
            }

            var rel = (world - body.position).xzy;
            var position = FrameYaw.Rotate(new Sitrep.Contract.Vector3d(rel.x, rel.y, rel.z), fit.Yaw);
            if (!(position.Magnitude() > 0.0))
            {
                return null;
            }

            // The reference UT is NOW, not the caller's ut.
            //
            // precisePosition is where the station is at this instant, so
            // stamping it with a past reference UT time-shifts the station's
            // entire trajectory by (now - ut), and the sweep origin CAN be far in
            // the past - a deadline upgrade evaluates from the silence onset,
            // hours earlier. Every other input to this geometry is
            // epoch-anchored (OrbitElements carries epoch + meanAnomalyAtEpoch),
            // so the station was the only term that could drift, and it drifted
            // silently.
            return new RotatingGroundStation(
                position,
                Planetarium.GetUniversalTime(),
                body.rotationPeriod,
                position.Magnitude(),
                0.0,
                fit.SpinAxis);
        }

        /// <summary>
        /// Compares the geometry's own vessel-to-station separation at
        /// <paramref name="ut"/> against the live world-space one. Separation
        /// is rotation-invariant, so this checks the elements, the chain and
        /// the station's rotation phase all at once without ever needing to
        /// know how KSP's world axes map onto the propagation frame's.
        /// </summary>
        private bool ReconcilesWithTheLiveScene(
            OrbitToRemoteStationGeometry geometry,
            SilenceSample sample,
            CommNode comm,
            CelestialBody stationBody,
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
                DecomposeResidual(sample, vessel, stationBody, comm, geometry, now);
                SilenceTrace.FrameCheckFailed(live, predicted, residual);
                return false;
            }
            return true;
        }

        private readonly Dictionary<int, FrameFit> _frameFits = new Dictionary<int, FrameFit>();
        private readonly Dictionary<int, string> _frameFitReported = new Dictionary<int, string>();

        /// <summary>
        /// How the game's world axes map onto the propagation frame for one body: a
        /// heading about +Z, and the direction the body spins about once that
        /// heading is applied (+Z when the game keeps the body's axis along the
        /// frame's up).
        /// </summary>
        private struct FrameFit
        {
            public double Ut;
            public bool Ok;
            public double Yaw;
            public Sitrep.Contract.Vector3d SpinAxis;
        }

        /// <summary>
        /// The frame fit for the station body: the heading, in radians about +Z,
        /// that carries the game's world axes onto the propagation frame's, read
        /// from the body's own position about its parent (a vector known in both,
        /// whose heading is one unambiguous angle), and the body's spin axis in
        /// the propagation frame, which is the axis the game reports for it turned
        /// by that heading. Fitted once per game tick per body.
        ///
        /// <para>The spin axis is read rather than assumed: stock keeps every
        /// axis along the frame's up, and a physics mod can give bodies their real axial
        /// tilt, so a station placed on a tilted body must turn about the tilted
        /// axis or it drifts off its true position as the body spins.</para>
        ///
        /// <para>False when the body has no parent to read it from, or when the two
        /// vectors do not differ by a turn about +Z: no station is placed then,
        /// and no prediction is made from a frame that is not understood. Each
        /// change of outcome is logged once, never per tick.</para>
        /// </summary>
        private bool TryFitFrame(CelestialBody stationBody, IList<CelestialBody> bodies, out FrameFit fit)
        {
            fit = new FrameFit { SpinAxis = new Sitrep.Contract.Vector3d(0.0, 0.0, 1.0) };
            var index = bodies.IndexOf(stationBody);
            if (index < 0)
            {
                return false;
            }

            var now = Planetarium.GetUniversalTime();
            FrameFit cached;
            if (_frameFits.TryGetValue(index, out cached) && cached.Ut == now)
            {
                fit = cached;
                return cached.Ok;
            }

            string report;
            var ok = MeasureFrame(stationBody, bodies, index, now, out fit, out report);
            fit.Ut = now;
            fit.Ok = ok;
            _frameFits[index] = fit;

            string previous;
            var outcome = ok ? "fitted" : report;
            if (!_frameFitReported.TryGetValue(index, out previous) || previous != outcome)
            {
                _frameFitReported[index] = outcome;
                SilenceTrace.Calibration(ok
                    ? stationBody.bodyName + " world frame fitted, heading "
                        + Degrees(fit.Yaw) + " deg, spin axis tilted "
                        + Degrees(Math.Acos(Math.Max(-1.0, Math.Min(1.0, fit.SpinAxis.Z)))) + " deg from the frame's up"
                    : stationBody.bodyName + " world frame not fitted: " + report
                        + "; no prediction is published for it until it fits");
            }
            return ok;
        }

        private static string Degrees(double radians) =>
            (radians * 180.0 / Math.PI).ToString("F1", System.Globalization.CultureInfo.InvariantCulture);

        private bool MeasureFrame(
            CelestialBody stationBody,
            IList<CelestialBody> bodies,
            int index,
            double now,
            out FrameFit fit,
            out string report)
        {
            fit = new FrameFit { SpinAxis = new Sitrep.Contract.Vector3d(0.0, 0.0, 1.0) };
            var parent = stationBody.referenceBody;
            var parentIndex = parent != null ? bodies.IndexOf(parent) : -1;
            if (parent == null || parent == stationBody || parentIndex < 0)
            {
                report = "it has no parent body to read the frame from";
                return false;
            }

            var pole = stationBody.BodyFrame.LocalToWorld(new Vector3d(0.0, 0.0, 1.0));
            var poleLength = pole.magnitude;
            if (double.IsNaN(poleLength) || double.IsInfinity(poleLength) || !(poleLength > 0.0))
            {
                report = "the game reports no spin axis for it";
                return false;
            }

            var target = PropagationTarget.Body(index);
            var frame = PropagationFrame.CentredOn(parentIndex);
            if (!_propagator.CanPropagate(target, frame, now, now))
            {
                report = "no propagatable path from " + parent.bodyName;
                return false;
            }

            var rel = (stationBody.position - parent.position).xzy;
            var inWorld = new Sitrep.Contract.Vector3d(rel.x, rel.y, rel.z);
            var inPropagation = _propagator.Solve(target, frame, now).Position;

            FrameYawRefusal refusal;
            double mismatch;
            double yaw;
            if (FrameYaw.TryMeasure(inWorld, inPropagation, out yaw, out refusal, out mismatch))
            {
                var axis = FrameYaw.Rotate(
                    new Sitrep.Contract.Vector3d(pole.x / poleLength, pole.y / poleLength, pole.z / poleLength), yaw);
                fit = new FrameFit { Yaw = yaw, SpinAxis = axis };
                report = string.Empty;
                return true;
            }

            switch (refusal)
            {
                case FrameYawRefusal.NearAxis:
                    report = "the body sits too close to the spin axis of " + parent.bodyName + " to read a heading";
                    break;
                case FrameYawRefusal.OffAxisMismatch:
                case FrameYawRefusal.LengthMismatch:
                    report = "the game's position of the body about " + parent.bodyName
                        + " is not a turn of the propagated one (they differ by "
                        + mismatch.ToString("F0", System.Globalization.CultureInfo.InvariantCulture) + " m)";
                    break;
                default:
                    report = "the body's position about " + parent.bodyName + " is not a real number";
                    break;
            }
            return false;
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

        /// <summary>
        /// The vessel's own CommNet node, the transmitting end of every pair the
        /// reach question is asked about. Null for a vessel with no live
        /// connection, which is the ordinary unloaded case and simply means no
        /// backend can rate the pair: the prediction then falls back to geometry
        /// alone, exactly as it did before reach was modelled.
        /// </summary>
        private static CommNode VesselNode(string vesselId)
        {
            var vessel = FindVessel(vesselId);
            return vessel == null || vessel.connection == null ? null : vessel.connection.Comm;
        }

        /// <summary>
        /// How far the elected comms backend will carry the link between the
        /// craft and one station. Its maximum being null asserts no limit and
        /// applies no term, which is what an unelected backend, an unrateable
        /// pair, and a vessel with no node all come back as; the model's id says
        /// which of those it was, so a prediction that modelled geometry only is
        /// declared rather than assumed.
        ///
        /// <para>Asked of the seam rather than derived here for the reason
        /// <c>CommsReach.cs</c> sets out at length: the missing half is a
        /// different half per backend, and stock's rule applied on a
        /// RealAntennas install reports zero reach for every craft in the game
        /// because RA zeroes the power fields it reads.</para>
        /// </summary>
        private ICommsReachModel ReachTo(CommNode vesselNode, CommNode station)
        {
            if (vesselNode == null || station == null)
            {
                return CommsReachModels.Unknown;
            }
            return CommsElection.ReachModel(_kernel(), CommsNodeHandle.Of(vesselNode), CommsNodeHandle.Of(station));
        }

        internal static double OccludingRadiusOf(ICommsOcclusionModel model, CelestialBody body)
        {
            if (body == null)
            {
                return 0.0;
            }
            return model.OccludingRadiusMeters(body.Radius, body.atmosphere);
        }

        /// <summary>
        /// Reports each propagated term beside the live value it should match,
        /// so a wrong answer says which element set is wrong rather than only
        /// that the total does not reconcile.
        /// </summary>
        private void DecomposeResidual(
            SilenceSample sample,
            Vessel vessel,
            CelestialBody stationBody,
            CommNode comm,
            OrbitToRemoteStationGeometry geometry,
            double now)
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

                // The station body about ITS parent: the term the vessel-side link
                // is blind to when the craft orbits the star, since that link is
                // then absent and the whole interplanetary composition rides on
                // this one.
                var stationUp = stationBody != null && stationBody.orbit != null
                    && stationBody.orbit.referenceBody != null && stationBody.orbit.referenceBody != stationBody
                    ? stationBody.orbit
                    : null;
                var liveStation = stationUp != null ? stationUp.getRelativePositionAtUT(now).magnitude : 0.0;
                var predictedStation = 0.0;
                if (stationUp != null && bodies != null)
                {
                    predictedStation = _propagator.Solve(
                        PropagationTarget.Body(bodies.IndexOf(stationBody)),
                        PropagationFrame.CentredOn(bodies.IndexOf(stationUp.referenceBody)),
                        now).Position.Magnitude();
                }

                SilenceTrace.Decompose(
                    liveVessel, predictedVessel, liveLink, predictedLink, liveStation, predictedStation);

                // The three terms above are magnitudes of positions about a
                // parent, so none of them sees a direction, and none contains the
                // station's place on its own body. These two are the separation's
                // own anatomy, measured from the station body's centre: where the
                // vessel is, and how far the station sits toward it. Both survive
                // a rotation of the whole frame, so the live world-axes value and
                // the propagation-frame value compare directly.
                var centre = stationBody.position;
                var vesselFromCentre = vessel.orbitDriver.orbit.getPositionAtUT(now) - centre;
                var stationFromCentre = comm.precisePosition - centre;
                var liveCentreToVessel = vesselFromCentre.magnitude;
                var liveToward = liveCentreToVessel > 0.0
                    ? Vector3d.Dot(stationFromCentre, vesselFromCentre) / liveCentreToVessel
                    : 0.0;
                var predicted = geometry.AnatomyAt(now);

                FrameFit fit = default(FrameFit);
                var fitted = bodies != null && TryFitFrame(stationBody, bodies, out fit);
                SilenceTrace.DecomposeStation(
                    liveCentreToVessel, predicted.CentreToVesselMeters,
                    liveToward, predicted.StationTowardVesselMeters,
                    stationFromCentre.magnitude, predicted.StationFromCentreMeters,
                    stationBody.bodyName,
                    stationBody.inverseRotation,
                    Planetarium.InverseRotAngle,
                    stationBody.rotationAngle,
                    stationBody.directRotAngle,
                    fitted ? (double?)(fit.Yaw * 180.0 / Math.PI) : null);
            }
            catch (Exception ex)
            {
                SilenceTrace.NoGeometry("decompose threw: " + ex.Message);
            }
        }

        internal static OrbitElements ElementsOf(Orbit orbit) =>
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
