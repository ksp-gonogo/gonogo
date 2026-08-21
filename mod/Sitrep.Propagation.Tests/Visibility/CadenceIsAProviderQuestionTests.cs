using System;
using System.Collections.Generic;
using Sitrep.Propagation.Visibility;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// A geometry's cycle is whatever the elected propagation provider says the
    /// target's motion repeats on, and a provider is allowed to say "nothing".
    ///
    /// <para>The sweep sizes both its step and its window from this number, and the
    /// silence policy derives its grace from that step, so "what is the period"
    /// reaches all the way through to when a craft is declared lost. Two-body
    /// motion has a period; a general trajectory does not. A geometry that computed
    /// <c>2*pi*sqrt(a^3/mu)</c> for itself could never express the second case, and
    /// both geometries used to do exactly that.</para>
    /// </summary>
    public class CadenceIsAProviderQuestionTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const double KerbinSiderealDay = 21_549.425;

        private static OrbitElements LowOrbit() => new OrbitElements(
            sma: KerbinRadius + 100_000.0,
            ecc: 0.0,
            inc: 0.0,
            lan: 0.0,
            argPe: 0.0,
            meanAnomalyAtEpoch: 0.0,
            epoch: 0.0,
            mu: KerbinMu);

        private const int Kerbin = 0;

        private static PropagationTarget LowCraft() =>
            PropagationTarget.Vessel("test-craft", Kerbin, LowOrbit());

        private static RotatingGroundStation Station(double rotationPeriodSeconds = KerbinSiderealDay) =>
            new RotatingGroundStation(
                surfaceNormalAtReferenceUt: new Vector3d(1.0, 0.0, 0.0),
                referenceUt: 0.0,
                rotationPeriodSeconds: rotationPeriodSeconds,
                bodyRadiusMeters: KerbinRadius,
                altitudeMeters: 0.0);

        /// <summary>
        /// Declines every cycle and every solve. Stands in for a provider whose
        /// motion has no repeat, which is the case the nullable answer exists for.
        /// </summary>
        private sealed class NoCycleProvider : IPropagationProvider
        {
            public string ProviderId => "no-cycle";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                new KeplerProvider().Solve(target, frame, ut);

            public void SolveMany(
                PropagationTarget target, PropagationFrame frame, IReadOnlyList<double> uts, StateVector[] into)
            {
                for (var i = 0; i < uts.Count; i++) into[i] = Solve(target, frame, uts[i]);
            }

            public double? CharacteristicCycleSeconds(PropagationTarget target) => null;

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public bool CanPropagate(PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) =>
                true;

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt) => null;
        }

        [Fact]
        public void ADirectGeometryTakesItsPeriodFromTheProvider()
        {
            var geometry = new OrbitToGroundStationGeometry(LowCraft(), Station(), KerbinRadius);

            var expected = new KeplerProvider().CharacteristicCycleSeconds(LowCraft());

            Assert.NotNull(geometry.PeriodSeconds);
            Assert.Equal(expected!.Value, geometry.PeriodSeconds!.Value, 6);
        }

        [Fact]
        public void ADirectGeometryHasNoPeriodWhenTheProviderDeclines()
        {
            var geometry = new OrbitToGroundStationGeometry(
                LowCraft(), Station(), KerbinRadius, new NoCycleProvider());

            Assert.Null(geometry.PeriodSeconds);
        }

        [Fact]
        public void ADirectGeometryFallsBackToTheStationsDayWhenThereIsNoPeriod()
        {
            // The station's spin survives n-body untouched: a body's rotation is not
            // orbital mechanics. So a geometry with no orbital period still has a
            // cycle worth sweeping at, and the sweep keeps its detection guarantee.
            var geometry = new OrbitToGroundStationGeometry(
                LowCraft(), Station(), KerbinRadius, new NoCycleProvider());

            Assert.Equal(KerbinSiderealDay, geometry.ShortestCycleSeconds!.Value, 3);
        }

        [Fact]
        public void ADirectGeometryHasNoCycleAtAllWhenNeitherTermExists()
        {
            // No period and a station held fixed in the inertial frame. There is
            // nothing left to size a step against, and inventing one would publish a
            // detection guarantee the sweep cannot honour.
            var geometry = new OrbitToGroundStationGeometry(
                LowCraft(), Station(rotationPeriodSeconds: 0.0), KerbinRadius, new NoCycleProvider());

            Assert.Null(geometry.ShortestCycleSeconds);
        }

        [Fact]
        public void ARemoteGeometryTakesItsPeriodFromTheProvider()
        {
            var geometry = new OrbitToRemoteStationGeometry(
                LowCraft(),
                PropagationFrame.CentredOn(Kerbin),
                new OccludingBody[0],
                Station(),
                KerbinRadius);

            var expected = new KeplerProvider().CharacteristicCycleSeconds(LowCraft());

            Assert.NotNull(geometry.PeriodSeconds);
            Assert.Equal(expected!.Value, geometry.PeriodSeconds!.Value, 6);
        }

        [Fact]
        public void ARemoteGeometryFallsBackToTheFastestStationSpinWhenThereIsNoPeriod()
        {
            var geometry = new OrbitToRemoteStationGeometry(
                LowCraft(),
                PropagationFrame.CentredOn(Kerbin),
                new OccludingBody[0],
                new[] { Station(), Station(rotationPeriodSeconds: KerbinSiderealDay / 4.0) },
                KerbinRadius,
                new NoCycleProvider());

            Assert.Equal(KerbinSiderealDay / 4.0, geometry.ShortestCycleSeconds!.Value, 3);
        }

        [Fact]
        public void ARemoteGeometryHasNoCycleAtAllWhenNeitherTermExists()
        {
            var geometry = new OrbitToRemoteStationGeometry(
                LowCraft(),
                PropagationFrame.CentredOn(Kerbin),
                new OccludingBody[0],
                Station(rotationPeriodSeconds: 0.0),
                KerbinRadius,
                new NoCycleProvider());

            Assert.Null(geometry.ShortestCycleSeconds);
        }
    }
}
