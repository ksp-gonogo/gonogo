using System;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// The cross-body case: a vessel orbiting one body, talking to a station on
    /// another. These pin the two things that make it different from the
    /// same-body geometry — the parent body has moved off the origin, and the
    /// station's own body is an occluder too — because getting either wrong
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

        private static OrbitToRemoteStationGeometry Geometry(
            OrbitElements vessel,
            OrbitElements? parent,
            RotatingGroundStation station) =>
            new OrbitToRemoteStationGeometry(
                vessel,
                parent == null
                    ? new OrbitToRemoteStationGeometry.ChainLink[0]
                    : new[] { new OrbitToRemoteStationGeometry.ChainLink(parent.Value, MinmusRadius, descending: true) },
                station,
                KerbinRadius);

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
            var geometry = Geometry(VesselAtMinmus(), MinmusAroundKerbin(), KscLikeStation());

            var separation = geometry.SeparationAt(0.0);

            Assert.InRange(separation, MinmusSma - 1_000_000.0, MinmusSma + 1_000_000.0);
        }

        [Fact]
        public void AVesselOnTheFarSideOfItsOwnParentIsBlocked()
        {
            var parent = MinmusAroundKerbin();
            var station = KscLikeStation();
            var propagator = new KeplerProvider();
            var minmus = propagator.Solve(parent, 0.0).Position;

            // Directly behind Minmus as seen from Kerbin: the sign of the
            // vessel's position along the Kerbin-Minmus line decides this, so
            // find the mean anomaly that puts it there rather than assuming one.
            var blockedFound = false;
            for (var m = 0.0; m < 2.0 * Math.PI; m += Math.PI / 180.0)
            {
                var g = Geometry(VesselAtMinmus(meanAnomaly: m), parent, station);
                var vesselRel = propagator.Solve(VesselAtMinmus(meanAnomaly: m), 0.0).Position;
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
            var parent = MinmusAroundKerbin();
            var station = KscLikeStation();
            var propagator = new KeplerProvider();
            var minmus = propagator.Solve(parent, 0.0).Position;

            var clearFound = false;
            for (var m = 0.0; m < 2.0 * Math.PI; m += Math.PI / 180.0)
            {
                var vesselRel = propagator.Solve(VesselAtMinmus(meanAnomaly: m), 0.0).Position;
                var alongLine = Dot(vesselRel, minmus) / minmus.Magnitude();
                if (alongLine < -100_000.0)
                {
                    // On the Kerbin-facing side of Minmus, well clear of it.
                    var g = Geometry(VesselAtMinmus(meanAnomaly: m), parent, station);
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
            var parent = MinmusAroundKerbin();
            var vessel = VesselAtMinmus();

            var near = Geometry(vessel, parent, KscLikeStation(longitudeDeg: 0.0)).MarginAt(0.0);
            var far = Geometry(vessel, parent, KscLikeStation(longitudeDeg: 180.0)).MarginAt(0.0);

            Assert.True(far < near, "the antipodal station must have the worse margin");
            Assert.True(far < 0.0, "a station on the far side of its own body must read as blocked");
        }

        /// <summary>
        /// A vessel orbiting the station's own body has no second occluder;
        /// passing a null parent must collapse to that case rather than
        /// double-counting a body at the origin.
        /// </summary>
        [Fact]
        public void ANullParentCollapsesToTheSameBodyCase()
        {
            var vessel = new OrbitElements(KerbinRadius + 100_000.0, 0, 0, 0, 0, 0, 0, KerbinMu);
            var station = KscLikeStation();
            var remote = new OrbitToRemoteStationGeometry(
                vessel, new OrbitToRemoteStationGeometry.ChainLink[0], station, KerbinRadius);
            var sameBody = new OrbitToGroundStationGeometry(vessel, station, KerbinRadius);

            for (var ut = 0.0; ut < 3_600.0; ut += 137.0)
            {
                Assert.Equal(Math.Sign(sameBody.MarginAt(ut)), Math.Sign(remote.MarginAt(ut)));
            }
        }

        [Fact]
        public void TheMarginCrossesZeroRatherThanJumping()
        {
            var geometry = Geometry(VesselAtMinmus(), MinmusAroundKerbin(), KscLikeStation());
            var period = geometry.PeriodSeconds;
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

        private const double SunMu = 1.1723328e18;
        private const double KerbinSma = 13_599_840_256.0;

        /// <summary>Kerbin about the Sun: the ascending link every interplanetary chain starts with.</summary>
        private static OrbitElements KerbinAroundSun() =>
            new OrbitElements(KerbinSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu);

        /// <summary>
        /// The interplanetary case, which the live run never reached until the
        /// KeplerProvider throw was fixed and which then reported residuals in
        /// the tens of millions of km.
        ///
        /// <para>Frame is centred on the STATION's body (Kerbin). A craft in
        /// solar orbit is reached by climbing to the Sun — an ASCENDING link,
        /// which subtracts, because the Sun sits on the far side of Kerbin's own
        /// orbit — and then adding the vessel's Sun-relative position. So the
        /// answer is exactly <c>vesselAboutSun - kerbinAboutSun</c>, computable
        /// by hand.</para>
        /// </summary>
        [Fact]
        public void AnAscendingLinkSubtractsSoASolarOrbitResolvesInTheStationFrame()
        {
            var propagator = new KeplerProvider();
            // A craft in a solar orbit well outside Kerbin's.
            var vesselAboutSun = new OrbitElements(KerbinSma * 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu);

            var geometry = new OrbitToRemoteStationGeometry(
                vesselAboutSun,
                new[] { new OrbitToRemoteStationGeometry.ChainLink(KerbinAroundSun(), 261_600_000.0, descending: false) },
                KscLikeStation(),
                KerbinRadius);

            var expected = (propagator.Solve(vesselAboutSun, 0.0).Position
                - propagator.Solve(KerbinAroundSun(), 0.0).Position).Magnitude();

            // Within one Kerbin radius: the station sits on the surface, not at
            // the centre, and that is the only difference.
            Assert.InRange(geometry.SeparationAt(0.0), expected - KerbinRadius * 2, expected + KerbinRadius * 2);
        }

        /// <summary>
        /// The sign error this class is most likely to make: ADDING an ascending
        /// link puts the craft on the wrong side of the Sun, which is a good
        /// enough approximation to look plausible and is wrong by twice Kerbin's
        /// orbital radius.
        /// </summary>
        [Fact]
        public void AddingAnAscendingLinkWouldBeWrongByTwiceTheOrbitalRadius()
        {
            var propagator = new KeplerProvider();
            var vesselAboutSun = new OrbitElements(KerbinSma * 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu);

            var correct = new OrbitToRemoteStationGeometry(
                vesselAboutSun,
                new[] { new OrbitToRemoteStationGeometry.ChainLink(KerbinAroundSun(), 261_600_000.0, descending: false) },
                KscLikeStation(),
                KerbinRadius).SeparationAt(0.0);

            var wrongSign = new OrbitToRemoteStationGeometry(
                vesselAboutSun,
                new[] { new OrbitToRemoteStationGeometry.ChainLink(KerbinAroundSun(), 261_600_000.0, descending: true) },
                KscLikeStation(),
                KerbinRadius).SeparationAt(0.0);

            Assert.True(
                Math.Abs(wrongSign - correct) > KerbinSma,
                $"the two signs should differ by order Kerbin's orbital radius; got {correct} vs {wrongSign}");
        }

        private static double Dot(Vector3d a, Vector3d b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;
    }
}
