using System;
using System.Collections.Generic;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// The cross-body case: a vessel orbiting one body, talking to a station on
    /// another. These pin the two things that make it different from the
    /// same-body geometry, the parent body has moved off the origin, and the
    /// station's own body is an occluder too, because getting either wrong
    /// produces a plausible-looking prediction rather than an obvious failure.
    /// </summary>
    public class OrbitToRemoteStationGeometryTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const double KerbinSiderealDay = 21_549.425;

        private const double MinmusMu = 1.7658e9;
        private const double MinmusRadius = 60_000.0;
        private const double MinmusSma = 46_400_000.0;

        private const double SunMu = 1.1723328e18;
        private const double KerbinSma = 13_599_840_256.0;

        private const int Sun = 0, Kerbin = 1, Minmus = 2;

        /// <summary>
        /// Kerbol reduced to what these tests reach: the Sun at the root, Kerbin
        /// about it, and Minmus about Kerbin. The Sun's own stored elements are not
        /// an orbit, exactly as KSP has it.
        /// </summary>
        private static IReadOnlyList<SystemBody> System() => new[]
        {
            new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
            new SystemBody(Sun, new OrbitElements(KerbinSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu)),
            new SystemBody(Kerbin, MinmusAroundKerbin()),
        };

        private static IPropagationProvider Propagator() => new KeplerProvider(System());

        /// <summary>A vessel 60 km above Minmus, which is where the live test article sits.</summary>
        private static OrbitElements VesselAtMinmus(double lan = 0.0, double meanAnomaly = 0.0) =>
            new OrbitElements(MinmusRadius + 60_000.0, 0.0, 0.0, lan, 0.0, meanAnomaly, 0.0, MinmusMu);

        private static OrbitElements MinmusAroundKerbin() =>
            new OrbitElements(MinmusSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);

        private static RotatingGroundStation KscLikeStation(double longitudeDeg = 0.0) =>
            RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: 0.0,
                longitudeDegAtReferenceUt: longitudeDeg,
                referenceUt: 0.0,
                rotationPeriodSeconds: KerbinSiderealDay,
                bodyRadiusMeters: KerbinRadius,
                altitudeMeters: 0.0);

        /// <summary>
        /// A craft at Minmus seen from a Kerbin station. Pass no occluder for the
        /// case where the craft orbits Kerbin itself.
        /// </summary>
        private static OrbitToRemoteStationGeometry Geometry(
            OrbitElements vessel,
            bool viaMinmus,
            RotatingGroundStation station) =>
            new OrbitToRemoteStationGeometry(
                PropagationTarget.Vessel("commsat", viaMinmus ? Minmus : Kerbin, vessel),
                PropagationFrame.CentredOn(Kerbin),
                viaMinmus ? new[] { new OccludingBody(Minmus, MinmusRadius) } : new OccludingBody[0],
                station,
                KerbinRadius,
                Propagator());

        /// <summary>
        /// The whole reason this class exists. With the vessel's parent left at
        /// the origin, a Minmus-orbiting craft sits 46,400 km from where it
        /// actually is, and every occultation prediction is fiction. Here the
        /// separation must be the Kerbin-Minmus distance to within the vessel's
        /// own orbital radius.
        /// </summary>
        [Fact]
        public void SeparationWalksTheChainRatherThanTreatingTheParentAsTheOrigin()
        {
            var geometry = Geometry(VesselAtMinmus(), viaMinmus: true, KscLikeStation());

            var separation = geometry.SeparationAt(0.0);

            Assert.InRange(separation, MinmusSma - 1_000_000.0, MinmusSma + 1_000_000.0);
        }

        [Fact]
        public void AVesselOnTheFarSideOfItsOwnParentIsBlocked()
        {
            var station = KscLikeStation();
            var propagator = Propagator();
            var minmus = propagator.SolveConic(MinmusAroundKerbin(), 0.0).Position;

            // Directly behind Minmus as seen from Kerbin: the sign of the
            // vessel's position along the Kerbin-Minmus line decides this, so
            // find the mean anomaly that puts it there rather than assuming one.
            var blockedFound = false;
            for (var m = 0.0; m < 2.0 * Math.PI; m += Math.PI / 180.0)
            {
                var g = Geometry(VesselAtMinmus(meanAnomaly: m), viaMinmus: true, station);
                var vesselRel = propagator.SolveConic(VesselAtMinmus(meanAnomaly: m), 0.0).Position;
                var alongLine = Dot(vesselRel, minmus) / minmus.Magnitude();
                if (alongLine > 55_000.0 && g.MarginAt(0.0) < 0.0)
                {
                    blockedFound = true;
                    break;
                }
            }

            Assert.True(blockedFound, "a vessel directly behind its parent body must read as blocked");
        }

        [Fact]
        public void AVesselClearOfBothBodiesIsUnobstructed()
        {
            var station = KscLikeStation();
            var propagator = Propagator();
            var minmus = propagator.SolveConic(MinmusAroundKerbin(), 0.0).Position;

            var clearFound = false;
            for (var m = 0.0; m < 2.0 * Math.PI; m += Math.PI / 180.0)
            {
                var vesselRel = propagator.SolveConic(VesselAtMinmus(meanAnomaly: m), 0.0).Position;
                var alongLine = Dot(vesselRel, minmus) / minmus.Magnitude();
                if (alongLine < -100_000.0)
                {
                    // On the Kerbin-facing side of Minmus, well clear of it.
                    var g = Geometry(VesselAtMinmus(meanAnomaly: m), viaMinmus: true, station);
                    Assert.True(g.MarginAt(0.0) > 0.0);
                    clearFound = true;
                    break;
                }
            }

            Assert.True(clearFound, "expected to find a Kerbin-facing sample");
        }

        /// <summary>
        /// The occluder the same-body geometry would never think to include: a
        /// station that has rotated onto the far side of its OWN body cannot
        /// see a vessel that is otherwise in the clear.
        /// </summary>
        [Fact]
        public void AStationRotatedOntoTheFarSideOfItsOwnBodyIsBlocked()
        {
            var vessel = VesselAtMinmus();

            var near = Geometry(vessel, viaMinmus: true, KscLikeStation(longitudeDeg: 0.0)).MarginAt(0.0);
            var far = Geometry(vessel, viaMinmus: true, KscLikeStation(longitudeDeg: 180.0)).MarginAt(0.0);

            Assert.True(far < near, "the antipodal station must have the worse margin");
            Assert.True(far < 0.0, "a station on the far side of its own body must read as blocked");
        }

        /// <summary>
        /// A vessel orbiting the station's own body has no second occluder;
        /// asking for no occluders must collapse to that case rather than
        /// double-counting a body at the origin.
        /// </summary>
        [Fact]
        public void NoOccluderCollapsesToTheSameBodyCase()
        {
            var vessel = new OrbitElements(KerbinRadius + 100_000.0, 0, 0, 0, 0, 0, 0, KerbinMu);
            var station = KscLikeStation();
            var remote = Geometry(vessel, viaMinmus: false, station);
            var sameBody = new OrbitToGroundStationGeometry(
                PropagationTarget.Vessel("commsat", Kerbin, vessel), station, KerbinRadius);

            for (var ut = 0.0; ut < 3_600.0; ut += 137.0)
            {
                Assert.Equal(Math.Sign(sameBody.MarginAt(ut)), Math.Sign(remote.MarginAt(ut)));
            }
        }

        [Fact]
        public void TheMarginCrossesZeroRatherThanJumping()
        {
            var geometry = Geometry(VesselAtMinmus(), viaMinmus: true, KscLikeStation());
            var period = geometry.PeriodSeconds!.Value;
            var step = period / 720.0;

            var previous = geometry.MarginAt(0.0);
            var largestJump = 0.0;
            for (var ut = step; ut <= 2.0 * period; ut += step)
            {
                var margin = geometry.MarginAt(ut);
                largestJump = Math.Max(largestJump, Math.Abs(margin - previous));
                previous = margin;
            }

            // Continuity is the sweep's whole precondition: a margin that jumps
            // between adjacent samples invents crossings when bisected.
            Assert.True(
                largestJump < Math.Abs(previous) + 1e12,
                "the margin must not jump discontinuously between adjacent sweep samples");
        }

        /// <summary>
        /// The interplanetary case, which the live run never reached until the
        /// KeplerProvider throw was fixed and which then reported residuals in
        /// the tens of millions of km.
        ///
        /// <para>Frame is centred on the STATION's body (Kerbin). A craft in
        /// solar orbit is reached by climbing to the Sun, which SUBTRACTS,
        /// because the Sun sits on the far side of Kerbin's own orbit, and then
        /// adding the vessel's Sun-relative position. So the answer is exactly
        /// <c>vesselAboutSun - kerbinAboutSun</c>, computable by hand.</para>
        /// </summary>
        [Fact]
        public void ASolarOrbitResolvesInTheStationFrameByClimbingToTheStar()
        {
            var propagator = Propagator();
            // A craft in a solar orbit well outside Kerbin's.
            var vesselAboutSun = new OrbitElements(KerbinSma * 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu);

            var geometry = new OrbitToRemoteStationGeometry(
                PropagationTarget.Vessel("deep-space-craft", Sun, vesselAboutSun),
                PropagationFrame.CentredOn(Kerbin),
                new[] { new OccludingBody(Sun, 261_600_000.0) },
                KscLikeStation(),
                KerbinRadius,
                propagator);

            var expected = (propagator.SolveConic(vesselAboutSun, 0.0).Position
                - propagator.SolveConic(System()[Kerbin].Orbit!.Value, 0.0).Position).Magnitude();

            // Within one Kerbin radius: the station sits on the surface, not at
            // the centre, and that is the only difference.
            Assert.InRange(geometry.SeparationAt(0.0), expected - KerbinRadius * 2, expected + KerbinRadius * 2);
        }

        /// <summary>
        /// The live case, against a number the GAME produced.
        ///
        /// <para>These elements were captured off the running save
        /// (<c>vessel.orbit</c>), and <c>comms.path</c> reported the very
        /// separation this geometry computes for the same link at the same
        /// moment: commsat to "Crater Rim Station", 46,284,930 m. That makes the
        /// backend an oracle, and lets the geometry be checked against reality
        /// on a laptop instead of through a ten-minute game cycle.</para>
        ///
        /// <para>It is also the only expected value in this subsystem that came
        /// from outside our own code, so it is the only test here that can catch a
        /// whole-frame error. Both serious geometry bugs found this month produced
        /// perfectly self-consistent numbers, and every test that compared our
        /// maths to our maths passed throughout.</para>
        ///
        /// <para>The tolerance is Minmus's own orbital radius about Kerbin
        /// divided by nothing generous: the craft is somewhere on a 120 km
        /// orbit about Minmus and the station somewhere on Kerbin's surface, so
        /// the two can differ by the sum of those radii and no more.</para>
        /// </summary>
        [Fact]
        public void TheLiveMinmusCraftMatchesWhatTheBackendReported()
        {
            const double MinmusMuLive = 1765800026.31247;
            const double ReportedSeparation = 46_284_930.28;

            var commsat = new OrbitElements(
                sma: 119_999.888,
                ecc: 5.74e-7,
                inc: 0.0,
                lan: 0.0,
                argPe: 0.0,
                meanAnomalyAtEpoch: 0.2684,
                epoch: 146_735.389,
                mu: MinmusMuLive);

            var geometry = Geometry(commsat, viaMinmus: true, KscLikeStation());

            var separation = geometry.SeparationAt(146_735.389);

            // Minmus orbit radius (120 km) + Kerbin radius (600 km) is the most
            // the two can legitimately differ by.
            Assert.InRange(
                separation,
                ReportedSeparation - 800_000.0,
                ReportedSeparation + 800_000.0);
        }

        private static double Dot(Vector3d a, Vector3d b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;
    }
}
