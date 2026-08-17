using System;
using System.Collections.Generic;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// What a sweep step has to be sized against. Visibility from a rotating
    /// ground station cycles at whichever term moves fastest, and for anything
    /// slower than the station's own day that is the DAY, not the orbit: a
    /// solar-orbit craft has a period of 1.02e7 s, so a step of period/720 is
    /// 14,167 s against Kerbin's 21,549 s day, i.e. 1.5 samples per visibility
    /// cycle where the sweep needs more than 2 to see a cycle at all.
    /// </summary>
    public class SweepCadenceTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const double KerbinSiderealDay = 21_549.425;
        private const double SunMu = 1.1723328e18;
        private const double KerbinSma = 13_599_840_256.0;

        private static RotatingGroundStation Station(
            double longitudeDeg = 0.0,
            double rotationPeriodSeconds = KerbinSiderealDay) =>
            RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: 0.0,
                longitudeDegAtReferenceUt: longitudeDeg,
                referenceUt: 0.0,
                rotationPeriodSeconds: rotationPeriodSeconds,
                bodyRadiusMeters: KerbinRadius,
                altitudeMeters: 0.0);

        private const int Sun = 0, Kerbin = 1;

        private static IReadOnlyList<SystemBody> System() => new[]
        {
            new SystemBody(-1, null),
            new SystemBody(Sun, new OrbitElements(KerbinSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu)),
        };

        private static IPropagationProvider Propagator() => new KeplerProvider(System());

        /// <summary>A craft in solar orbit just outside Kerbin's, reached by climbing to the Sun.</summary>
        private static OrbitToRemoteStationGeometry SolarOrbitCraft(params RotatingGroundStation[] stations) =>
            new OrbitToRemoteStationGeometry(
                PropagationTarget.Vessel(
                    "solar-craft", Sun, new OrbitElements(KerbinSma * 1.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, SunMu)),
                PropagationFrame.CentredOn(Kerbin),
                new[] { new OccludingBody(Sun, 261_600_000.0) },
                stations,
                KerbinRadius,
                Propagator());

        [Fact]
        public void ACraftSlowerThanTheStationsDayCyclesWithTheDay()
        {
            var geometry = SolarOrbitCraft(Station());

            Assert.True(
                geometry.PeriodSeconds!.Value > 100.0 * KerbinSiderealDay,
                $"expected a period far longer than the day; got {geometry.PeriodSeconds!.Value}");
            Assert.Equal(KerbinSiderealDay, geometry.ShortestCycleSeconds!.Value, 3);
        }

        [Fact]
        public void ACraftFasterThanTheStationsDayKeepsItsOwnPeriod()
        {
            var geometry = new OrbitToRemoteStationGeometry(
                PropagationTarget.Vessel(
                    "low-craft",
                    Kerbin,
                    new OrbitElements(KerbinRadius + 100_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu)),
                PropagationFrame.CentredOn(Kerbin),
                new OccludingBody[0],
                Station(),
                KerbinRadius,
                Propagator());

            Assert.Equal(geometry.PeriodSeconds!.Value, geometry.ShortestCycleSeconds!.Value, 3);
        }

        /// <summary>
        /// A retrograde body spins just as fast as a prograde one; only the
        /// direction differs. Taking the signed period as a cycle length would
        /// make the minimum a negative number and hand the sweep a negative
        /// step, which it rejects outright.
        /// </summary>
        [Fact]
        public void ARetrogradeSpinCountsAtItsMagnitude()
        {
            var geometry = SolarOrbitCraft(Station(rotationPeriodSeconds: -KerbinSiderealDay));

            Assert.Equal(KerbinSiderealDay, geometry.ShortestCycleSeconds!.Value, 3);
        }

        /// <summary>
        /// <see cref="RotatingGroundStation"/> holds a station with no usable
        /// spin rate fixed in the inertial frame, so it contributes no cycle at
        /// all rather than an infinitely fast one.
        /// </summary>
        [Fact]
        public void AStationWithNoUsableSpinContributesNoCycle()
        {
            var geometry = SolarOrbitCraft(Station(rotationPeriodSeconds: 0.0));

            Assert.Equal(geometry.PeriodSeconds!.Value, geometry.ShortestCycleSeconds!.Value, 3);
        }

        /// <summary>
        /// The geometry takes a SET of stations, and they need not all sit on
        /// the same body's spin. The fastest of them is the one the step has to
        /// resolve.
        /// </summary>
        [Fact]
        public void TheFastestStationInTheSetSetsTheCadence()
        {
            var geometry = SolarOrbitCraft(
                Station(rotationPeriodSeconds: KerbinSiderealDay),
                Station(longitudeDeg: 90.0, rotationPeriodSeconds: KerbinSiderealDay / 4.0));

            Assert.Equal(KerbinSiderealDay / 4.0, geometry.ShortestCycleSeconds!.Value, 3);
        }

        [Fact]
        public void TheSameBodyGeometryCyclesWithWhicheverOfOrbitAndDayIsFaster()
        {
            var lowOrbit = new OrbitToGroundStationGeometry(
                PropagationTarget.Vessel(
                    "low-craft",
                    Kerbin,
                    new OrbitElements(KerbinRadius + 100_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu)),
                Station(),
                KerbinRadius);
            var farOrbit = new OrbitToGroundStationGeometry(
                PropagationTarget.Vessel(
                    "far-craft", Kerbin, new OrbitElements(KerbinSma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu)),
                Station(),
                KerbinRadius);

            Assert.Equal(lowOrbit.PeriodSeconds!.Value, lowOrbit.ShortestCycleSeconds!.Value, 3);
            Assert.Equal(KerbinSiderealDay, farOrbit.ShortestCycleSeconds!.Value, 3);
        }

        /// <summary>
        /// The measured consequence, on a margin whose crossings are known in
        /// closed form: sampled at period/720 the sweep walks straight past the
        /// first emergence and reports the NEXT one, a full sidereal day late.
        /// Bisection keeps its bracket, so the late answer is a genuine
        /// emergence, which is exactly what makes the error invisible without a
        /// test like this one.
        /// </summary>
        [Fact]
        public void AStepSizedOnALongOrbitalPeriodReportsAnEmergenceADayLate()
        {
            const double vesselPeriod = 1.02e7;
            const double onset = 10_000.0;
            const double trueEmergence = 12_000.0;
            var geometry = new AnalyticGeometry(
                ut => Math.Sin(2.0 * Math.PI * (ut - trueEmergence) / KerbinSiderealDay));

            var undersampled = VisibilitySweep.Run(
                geometry, onset, onset + (2.0 * vesselPeriod), vesselPeriod / 720.0);
            var resolved = VisibilitySweep.Run(
                geometry, onset, onset + (2.0 * KerbinSiderealDay), KerbinSiderealDay / 720.0);

            Assert.Equal(trueEmergence + KerbinSiderealDay, FirstEmergence(undersampled), 0);
            Assert.Equal(trueEmergence, FirstEmergence(resolved), 1);
        }

        private static double FirstEmergence(VisibilitySweepResult sweep)
        {
            foreach (var change in sweep.Changes)
            {
                if (change.BecameClear)
                {
                    return change.Ut;
                }
            }

            throw new InvalidOperationException("the sweep found no emergence at all");
        }
    }
}
