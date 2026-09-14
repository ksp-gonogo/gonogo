using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.Propagation;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Every body says how far its own elements reach, and under stock that answer
    /// is "as far as you like".
    ///
    /// <para><b>Why a body needs to say anything.</b> A client will place every body
    /// at any UT it is asked for, which is exactly right when a body rides a fixed
    /// conic about a fixed parent and exactly wrong when the elements are the tangent
    /// to an integrated ephemeris. Nothing on the wire distinguished those two
    /// installs, so the client's only options were to extrapolate everything or to
    /// refuse everything. Now the producer states it, in the same words a craft's
    /// elements already use.</para>
    ///
    /// <para>The resolver is the seam, and it is the same shape as the craft-side one
    /// on <c>VesselViewProvider</c>: this provider never links the propagation
    /// assembly and cannot branch on which provider won.</para>
    /// </summary>
    [Collection("SystemViewProviderStatics")]
    public class BodyCarriesItsHorizonTests : IDisposable
    {
        public BodyCarriesItsHorizonTests()
        {
            SystemViewProvider.SetBodyHorizonSource(null);
        }

        public void Dispose()
        {
            SystemViewProvider.SetBodyHorizonSource(null);
        }

        [Fact]
        public void WithNoResolverEveryBodyClaimsAnUnboundedAnalyticEphemeris()
        {
            foreach (var body in BodiesOf(Build()))
            {
                var horizon = HorizonOf(body);
                Assert.Equal((int)PropagationHorizonKind.Unbounded, horizon["kind"]);
                Assert.Equal((int)TrajectoryKind.Analytic, horizon["trajectoryKind"]);
                // Never a sentinel standing in for forever: Unbounded is its own arm.
                Assert.Null(horizon["untilUt"]);
            }
        }

        /// <summary>
        /// The root star has no orbit and carries the horizon anyway. A payload where
        /// the field appears on some bodies and not others reads to a client as a
        /// producer that forgot on the rest, which is the one reading that must never
        /// be available.
        /// </summary>
        [Fact]
        public void TheRootStarCarriesOneToo()
        {
            var root = BodiesOf(Build())[0];
            Assert.Null(root["orbit"]);
            Assert.NotNull(root["horizon"]);
        }

        [Fact]
        public void AResolverIsAskedPerBodyAndAtTheSampleInstant()
        {
            var asked = new List<Tuple<int, double>>();
            SystemViewProvider.SetBodyHorizonSource((bodyIndex, sampleUt) =>
            {
                asked.Add(Tuple.Create(bodyIndex, sampleUt));
                return Until(sampleUt + 100.0 * (bodyIndex + 1));
            });

            var bodies = BodiesOf(Build());

            Assert.Equal(new[] { 0, 1, 2 }, asked.ConvertAll(a => a.Item1));
            Assert.All(asked, a => Assert.Equal(SampleUt, a.Item2));
            // Per body, not per catalogue: a moon deep in a satellite system and a
            // planet out on its own are pulled by different neighbourhoods, and one
            // number for everything would be the shortest applied to all of them.
            Assert.Equal(SampleUt + 100.0, HorizonOf(bodies[0])["untilUt"]);
            Assert.Equal(SampleUt + 200.0, HorizonOf(bodies[1])["untilUt"]);
            Assert.Equal(SampleUt + 300.0, HorizonOf(bodies[2])["untilUt"]);
        }

        /// <summary>
        /// A resolver that faults has told us neither the reach nor the shape, and
        /// both enums number that answer zero so it withholds rather than permits.
        /// Claiming Analytic here would be asserting the save runs two-body physics
        /// on the strength of an exception.
        /// </summary>
        [Fact]
        public void AFaultingResolverCostsTheClaimAndNotTheCatalogue()
        {
            SystemViewProvider.SetBodyHorizonSource(
                (_, _) => throw new InvalidOperationException("model unreadable"));

            var bodies = BodiesOf(Build());

            Assert.Equal(3, bodies.Count);
            foreach (var body in bodies)
            {
                var horizon = HorizonOf(body);
                Assert.Equal((int)PropagationHorizonKind.Unspecified, horizon["kind"]);
                Assert.Equal((int)TrajectoryKind.Unspecified, horizon["trajectoryKind"]);
            }
        }

        [Fact]
        public void AResolverThatAnswersNothingIsUnspecifiedRatherThanUnbounded()
        {
            SystemViewProvider.SetBodyHorizonSource((_, _) => null!);

            var horizon = HorizonOf(BodiesOf(Build())[1]);

            Assert.Equal((int)PropagationHorizonKind.Unspecified, horizon["kind"]);
        }

        /// <summary>
        /// The election's own arms, exercised through a real kernel rather than
        /// asserted about: a non-integrating provider is a stock install and its
        /// bodies are unbounded and analytic.
        /// </summary>
        [Fact]
        public void AnAnalyticInstallsBodiesAreUnboundedThroughTheElection()
        {
            var horizon = PropagationElection.BodyHorizonFor(null, 1, SampleUt);

            Assert.Equal(PropagationHorizonKind.Unbounded, horizon.Kind);
            Assert.Equal(TrajectoryKind.Analytic, horizon.TrajectoryKind);
            Assert.Null(horizon.UntilUt);
        }

        private const double SampleUt = 161_619.05;

        private static PropagationHorizon Until(double ut) =>
            new PropagationHorizon
            {
                Kind = PropagationHorizonKind.Until,
                TrajectoryKind = TrajectoryKind.Integrated,
                UntilUt = ut,
            };

        private static object? Build() =>
            SystemViewProvider.BuildSystemBodies(new KspSnapshot
            {
                Ut = SampleUt,
                Values = new Dictionary<string, object?>
                {
                    ["bodies"] = new List<object?>
                    {
                        new Dictionary<string, object?>
                        {
                            ["name"] = "Kerbol",
                            ["index"] = 0,
                        },
                        new Dictionary<string, object?>
                        {
                            ["name"] = "Kerbin",
                            ["index"] = 1,
                            ["parentIndex"] = 0,
                            ["sma"] = 13_599_840_256.0,
                            ["ecc"] = 0.0,
                        },
                        new Dictionary<string, object?>
                        {
                            ["name"] = "Mun",
                            ["index"] = 2,
                            ["parentIndex"] = 1,
                            ["sma"] = 12_000_000.0,
                            ["ecc"] = 0.0,
                        },
                    },
                },
            });

        private static List<IDictionary<string, object?>> BodiesOf(object? payload)
        {
            var wrapper = Assert.IsAssignableFrom<IDictionary<string, object?>>(payload);
            var list = Assert.IsAssignableFrom<IEnumerable<object?>>(wrapper["bodies"]);
            var bodies = new List<IDictionary<string, object?>>();
            foreach (var entry in list)
            {
                bodies.Add(Assert.IsAssignableFrom<IDictionary<string, object?>>(entry));
            }
            return bodies;
        }

        private static IDictionary<string, object?> HorizonOf(IDictionary<string, object?> body) =>
            Assert.IsAssignableFrom<IDictionary<string, object?>>(body["horizon"]);
    }
}
