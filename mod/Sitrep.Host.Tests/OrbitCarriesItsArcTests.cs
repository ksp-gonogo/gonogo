using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core.Serialization;
using Sitrep.Host.Propagation;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The arc reaching the wire on <c>vessel.orbit</c>, and the conditions under
    /// which it is not attempted at all.
    ///
    /// <para>Separate from the mapping tests beside it because these install a
    /// process-wide resolver and have to put it back. Every case here also asserts
    /// through the REAL serialization path, because an arc that maps into a
    /// <c>VesselOrbit</c> and then throws at the wire boundary is a frame silently
    /// dropped, and the payload looks perfect right up to the socket.</para>
    ///
    /// <para>The collection name is the hook for the next class that needs these
    /// statics, and joining it is what serialises the two. Nothing else needs it
    /// today: no other test asserts on the horizon or the arc, so a concurrent
    /// class cannot see what this one installs.</para>
    ///
    /// <para><b>Nothing here hand-sets the horizon, and that is a correction rather
    /// than a style.</b> Every case below used to install a hand-written integrating
    /// flag directly, which asserts everything downstream of the gate and nothing
    /// about whether any install can open it. The gate had no implementer at all for
    /// the whole life of the feature and this file was green throughout. So each case
    /// now RESOLVES a kernel and installs the same expression production installs,
    /// <see cref="PropagationElection.HorizonFor"/>: what a test chooses is which
    /// provider the install has, and both the shape and the reach are computed from
    /// that.</para>
    /// </summary>
    [Collection("VesselViewProviderStatics")]
    public class OrbitCarriesItsArcTests : IDisposable
    {
        private const string VesselGuid = "11111111-2222-3333-4444-555555555555";

        public void Dispose()
        {
            // Both resolvers are static, so a test that installed one and walked
            // away would change what every later test in this assembly sees.
            VesselViewProvider.SetTrajectoryArcSource(null);
            VesselViewProvider.SetHorizonSource(null);
        }

        /// <summary>
        /// An install whose elected provider integrates, wired to the consumer the
        /// way production wires it: a resolved kernel, and core's own question asked
        /// of whichever provider won.
        /// </summary>
        private static void IntegratingInstall(IPropagationProvider? provider = null)
        {
            var kernel = new Kernel();
            PropagationElection.RegisterCapability(kernel);
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = PropagationElection.CapabilityId,
                Id = "an-nbody-backend",
                Priority = 100.0,
                Factory = _ => provider ?? new IntegratingProvider(),
            });
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

            Assert.True(
                PropagationElection.ElectedIntegrates(kernel),
                "the registered integrating provider did not win the election, so nothing "
                + "below is testing what it claims to");
            VesselViewProvider.SetHorizonSource(
                (target, sampleUt) => PropagationElection.HorizonFor(kernel, target, sampleUt));
        }

        /// <summary>
        /// The stock install: nothing registered, so the two-body vanilla wins and
        /// the same expression answers false.
        /// </summary>
        private static void AnalyticInstall()
        {
            var kernel = new Kernel();
            PropagationElection.RegisterCapability(kernel);
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

            Assert.False(
                PropagationElection.ElectedIntegrates(kernel),
                "the stock two-body vanilla claimed integrated trajectories, so the gate is "
                + "not discriminating and every assertion here is vacuous");
            VesselViewProvider.SetHorizonSource(
                (target, sampleUt) => PropagationElection.HorizonFor(kernel, target, sampleUt));
        }

        /// <summary>
        /// A provider that integrates and vouches for a whole cycle of it: the marker
        /// for the shape, and a bound generous enough that the cases below are about
        /// what the horizon then DOES rather than about where it falls. Where it
        /// falls is <see cref="VouchingProvider"/>'s subject.
        /// </summary>
        private sealed class IntegratingProvider : IPropagationProvider, IIntegratedTrajectorySource
        {
            /// <summary>The cycle these elements imply, near enough: 700 km of semi-major axis about a mu of 3.5316e12.</summary>
            public const double CycleSeconds = 1958.0;

            public string ProviderId => "an-nbody-backend";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                new StateVector(new Vector3d(0, 0, 0), new Vector3d(0, 0, 0));

            public void SolveMany(
                PropagationTarget target,
                PropagationFrame frame,
                IReadOnlyList<double> uts,
                StateVector[] into)
            {
            }

            public double? CharacteristicCycleSeconds(PropagationTarget target) => CycleSeconds;

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public bool CanPropagate(
                PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) => true;

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt) => null;
        }

        /// <summary>
        /// A provider that integrates AND states how far it will vouch for a set of
        /// osculating elements: it refuses any window longer than
        /// <c>span</c>, which is what a provider whose horizon is a local property
        /// of the craft does.
        /// </summary>
        private sealed class VouchingProvider : IPropagationProvider, IIntegratedTrajectorySource
        {
            private readonly double _cycle;
            private readonly double _span;

            public VouchingProvider(double cycleSeconds, double spanSeconds)
            {
                _cycle = cycleSeconds;
                _span = spanSeconds;
            }

            public string ProviderId => "an-nbody-backend";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                new StateVector(new Vector3d(0, 0, 0), new Vector3d(0, 0, 0));

            public void SolveMany(
                PropagationTarget target,
                PropagationFrame frame,
                IReadOnlyList<double> uts,
                StateVector[] into)
            {
            }

            public double? CharacteristicCycleSeconds(PropagationTarget target) => _cycle;

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public bool CanPropagate(
                PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) =>
                toUt - fromUt <= _span;

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt) => null;
        }

        /// <summary>
        /// A provider whose bound is a property of the CRAFT rather than of the
        /// install: it reads the target's own elements and vouches for a window
        /// proportional to their eccentricity. Nothing about that number is
        /// physical; what matters is that two craft on the same cycle get different
        /// answers, which a fraction of a cycle cannot produce.
        /// </summary>
        private sealed class PerCraftProvider : IPropagationProvider, IIntegratedTrajectorySource
        {
            public string ProviderId => "an-nbody-backend";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                new StateVector(new Vector3d(0, 0, 0), new Vector3d(0, 0, 0));

            public void SolveMany(
                PropagationTarget target,
                PropagationFrame frame,
                IReadOnlyList<double> uts,
                StateVector[] into)
            {
            }

            public double? CharacteristicCycleSeconds(PropagationTarget target) => 4000.0;

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public bool CanPropagate(
                PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) =>
                toUt - fromUt <= 10_000.0 * (target.Osculating?.Ecc ?? 0.0);

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt) => null;
        }

        private static TrajectoryArc SomeArc(double fromUt, double toUt) => new TrajectoryArc
        {
            Frame = new TrajectoryFrameRef
            {
                Kind = TrajectoryFrameKind.BodyCentredInertial,
                CentreBodyIndex = 1,
                LengthsPulsate = false,
            },
            Points =
            {
                new TrajectoryPoint { Ut = fromUt, X = 700_000, Y = 0, Z = 0 },
                new TrajectoryPoint { Ut = toUt, X = 0, Y = 700_000, Z = 12_345 },
            },
            FromUt = fromUt,
            ToUt = toUt,
            SourcePointCount = 4096,
            Derivation = TrajectoryDerivation.OwnNBody,
            ForceModel = new TrajectoryForceModel
            {
                GravityModelFound = true,
                PerturbingBodyCount = 3,
                GeopotentialDegree = 0,
                BodyEphemeris = "kepler-from-snapshot",
                ThirdBodyDominance = 1.2e-3,
                Integrator = "velocity-verlet-fixed-step",
                StepSeconds = 6.5,
                StepCount = 300,
                Vacuum = true,
            },
        };

        private static KspSnapshot Snapshot(double ecc = 0.01) => new KspSnapshot
        {
            Ut = 0.0,
            Values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?> { ["id"] = VesselGuid },
                    ["orbit"] = new Dictionary<string, object?>
                    {
                        ["sma"] = 700_000.0,
                        ["ecc"] = ecc,
                        ["inc"] = 5.0,
                        ["lan"] = 10.0,
                        ["argPe"] = 20.0,
                        ["meanAnomalyAtEpoch"] = 1.2,
                        ["epoch"] = 0.0,
                        ["mu"] = 3.5316e12,
                        ["referenceBody"] = "Kerbin",
                        ["encounter"] = null,
                    },
                },
                ["bodies"] = new List<object?>
                {
                    new Dictionary<string, object?> { ["name"] = "Kerbin", ["index"] = 1 },
                },
            },
        };

        private static string WireJson(object? payload)
        {
            var streamData = new StreamData<object?>
            {
                Topic = VesselViewProvider.OrbitTopic,
                Payload = payload,
                Meta = new Meta
                {
                    Source = "vessel",
                    ValidAt = 0,
                    Vantage = "host",
                    Quality = Quality.OnRails,
                    Active = true,
                    Staleness = Staleness.Fresh,
                },
            };
            return EnvelopeCodec.WriteStreamData(streamData);
        }

        [Fact]
        public void AnIntegratingProviderNeverClaimsAnUnboundedHorizon()
        {
            // `Unbounded` is a CLAIM, made by a provider that genuinely has no
            // limit. An integrating one has three that can each bind first, so
            // saying it would have a client reasoning "unbounded, therefore
            // analytic, therefore an ellipse is fine" and drawing a closed conic
            // for a path the craft will not fly. Both halves are asserted, because
            // the shape and the reach are separate answers and stating one
            // correctly says nothing about the other.
            IntegratingInstall();

            var orbit = VesselViewProvider.BuildOrbit(Snapshot());

            Assert.NotNull(orbit);
            Assert.Equal(TrajectoryKind.Integrated, orbit!.Horizon.TrajectoryKind);
            Assert.Equal(PropagationHorizonKind.Until, orbit.Horizon.Kind);
            Assert.NotEqual(PropagationHorizonKind.Unbounded, orbit.Horizon.Kind);
            // Set if and only if the arm is `Until`, never a sentinel standing in
            // for forever.
            Assert.NotNull(orbit.Horizon.UntilUt);
            Assert.True(orbit.Horizon.UntilUt!.Value > 0.0);
        }

        /// <summary>
        /// The horizon is the window the PROVIDER vouches for, not a fraction of a
        /// cycle core picked.
        ///
        /// <para>The two answers are different numbers here on purpose: these
        /// elements imply a cycle of about 1958 seconds, so a quarter-cycle rule
        /// lands near 490 while the provider will only vouch for 300. Whose number
        /// arrives is the whole question, and the horizon is a LOCAL property of the
        /// craft that only the provider can compute.</para>
        /// </summary>
        [Fact]
        public void TheHorizonIsTheWindowTheProviderVouchesFor()
        {
            IntegratingInstall(new VouchingProvider(cycleSeconds: 4000.0, spanSeconds: 300.0));

            var orbit = VesselViewProvider.BuildOrbit(Snapshot());

            Assert.Equal(PropagationHorizonKind.Until, orbit!.Horizon.Kind);
            Assert.Equal(300.0, orbit.Horizon.UntilUt!.Value, 1);
        }

        /// <summary>
        /// Two craft whose elements differ get horizons that differ, because the
        /// provider's bound is a property of the craft and not of the install.
        ///
        /// <para>This is the failure the flat rule could not express: the same save
        /// at the same instant has horizons orders of magnitude apart between craft,
        /// and a constant fraction of each one's own cycle cannot produce that.</para>
        /// </summary>
        [Fact]
        public void TwoCraftOnTheSameCycleCanHaveDifferentHorizons()
        {
            IntegratingInstall(new PerCraftProvider());

            var calm = VesselViewProvider.BuildOrbit(Snapshot(ecc: 0.01));
            var stirred = VesselViewProvider.BuildOrbit(Snapshot(ecc: 0.02));

            Assert.Equal(PropagationHorizonKind.Until, calm!.Horizon.Kind);
            Assert.Equal(PropagationHorizonKind.Until, stirred!.Horizon.Kind);
            Assert.Equal(100.0, calm.Horizon.UntilUt!.Value, 1);
            Assert.Equal(200.0, stirred.Horizon.UntilUt!.Value, 1);
        }

        /// <summary>
        /// A provider that will not vouch for any window at all publishes no
        /// horizon, rather than one core computed on its behalf.
        ///
        /// <para>Unspecified reads as unpropagatable, which is the safe direction:
        /// the elements still publish, and no client draws a curve nothing vouched
        /// for.</para>
        /// </summary>
        [Fact]
        public void AProviderThatVouchesForNothingPublishesNoHorizon()
        {
            IntegratingInstall(new VouchingProvider(cycleSeconds: 4000.0, spanSeconds: -1.0));

            var orbit = VesselViewProvider.BuildOrbit(Snapshot());

            Assert.Equal(TrajectoryKind.Integrated, orbit!.Horizon.TrajectoryKind);
            Assert.Equal(PropagationHorizonKind.Unspecified, orbit.Horizon.Kind);
            Assert.Null(orbit.Horizon.UntilUt);
        }

        [Fact]
        public void AnAnalyticProviderStillSaysUnboundedAndAnalytic()
        {
            // The other side of the same fact, so the test above cannot pass by
            // the horizon being stuck rather than by it being decided.
            AnalyticInstall();

            var orbit = VesselViewProvider.BuildOrbit(Snapshot());

            Assert.Equal(TrajectoryKind.Analytic, orbit!.Horizon.TrajectoryKind);
            Assert.Equal(PropagationHorizonKind.Unbounded, orbit.Horizon.Kind);
            Assert.Null(orbit.Horizon.UntilUt);
        }

        [Fact]
        public void AnIntegratingProviderPublishesItsPointsBesideTheElements()
        {
            IntegratingInstall();
            var asked = 0;
            VesselViewProvider.SetTrajectoryArcSource((_, fromUt, toUt) =>
            {
                asked++;
                return TrajectoryArcAnswer.Drawn(SomeArc(fromUt, toUt));
            });

            var orbit = VesselViewProvider.BuildOrbit(Snapshot());

            Assert.NotNull(orbit);
            Assert.Equal(1, asked);
            Assert.NotNull(orbit!.Arc);
            Assert.Equal(TrajectoryRefusal.NotRefused, orbit.ArcRefusal);
            Assert.Equal(2, orbit.Arc!.Points.Count);
            Assert.Equal(4096, orbit.Arc.SourcePointCount);

            // Through the real serializer, because a payload that maps and then
            // throws at the wire boundary drops the frame with no other symptom.
            var json = WireJson(VesselViewProvider.BuildOrbitWire(Snapshot()));
            Assert.Contains("\"arc\"", json);
            Assert.Contains("\"kepler-from-snapshot\"", json);
            Assert.Contains("12345", json);
        }

        [Fact]
        public void TheArcIsAskedForTheWindowTheHorizonNamed()
        {
            // Not a window of our choosing. The whole reason the horizon is on the
            // wire is that a client must never be shown a curve nothing vouched for,
            // and picking a far end here would put that back one layer down.
            IntegratingInstall();
            double? askedTo = null;
            double? askedFrom = null;
            VesselViewProvider.SetTrajectoryArcSource((_, fromUt, toUt) =>
            {
                askedFrom = fromUt;
                askedTo = toUt;
                return TrajectoryArcAnswer.Drawn(SomeArc(fromUt, toUt));
            });

            var orbit = VesselViewProvider.BuildOrbit(Snapshot());

            Assert.NotNull(orbit!.Horizon.UntilUt);
            Assert.Equal(0.0, askedFrom!.Value, 6);
            Assert.Equal(orbit.Horizon.UntilUt!.Value, askedTo!.Value, 6);
        }

        [Fact]
        public void ARefusalRidesOnTheElementsInsteadOfTheArc()
        {
            IntegratingInstall();
            VesselViewProvider.SetTrajectoryArcSource(
                (_, _, _) => TrajectoryArcAnswer.Refused(TrajectoryRefusal.NoForceModel));

            var orbit = VesselViewProvider.BuildOrbit(Snapshot());

            Assert.Null(orbit!.Arc);
            Assert.Equal(TrajectoryRefusal.NoForceModel, orbit.ArcRefusal);

            var json = WireJson(VesselViewProvider.BuildOrbitWire(Snapshot()));
            Assert.Contains("\"arcRefusal\":2", json);
        }

        [Fact]
        public void NoArcIsAttemptedUnderAnUnboundedHorizon()
        {
            // An analytic provider's elements ARE its curve, so an arc beside them
            // would be a second, redundant answer free to drift from the first.
            var asked = 0;
            AnalyticInstall();
            VesselViewProvider.SetTrajectoryArcSource((_, fromUt, toUt) =>
            {
                asked++;
                return TrajectoryArcAnswer.Drawn(SomeArc(fromUt, toUt));
            });

            var orbit = VesselViewProvider.BuildOrbit(Snapshot());

            Assert.Equal(0, asked);
            Assert.Null(orbit!.Arc);
            Assert.Equal(TrajectoryRefusal.NotAttempted, orbit.ArcRefusal);
            Assert.Equal(PropagationHorizonKind.Unbounded, orbit.Horizon.Kind);
        }

        [Fact]
        public void AThrowingResolverCostsTheArcAndNotThePayload()
        {
            IntegratingInstall();
            VesselViewProvider.SetTrajectoryArcSource(
                (_, _, _) => throw new InvalidOperationException("boom"));

            var orbit = VesselViewProvider.BuildOrbit(Snapshot());

            Assert.NotNull(orbit);
            Assert.Equal(700_000.0, orbit!.Sma);
            Assert.Null(orbit.Arc);
            // Nothing was refused: a resolver fault is our bug, not a state the
            // operator can act on, and naming a remedy for it would misdirect.
            Assert.Equal(TrajectoryRefusal.NotAttempted, orbit.ArcRefusal);
        }

        [Fact]
        public void WithNoResolverInstalledTheElementsStillPublish()
        {
            // An integrating install whose arc source was never installed: the
            // horizon still says integrated, and the arc says nothing was sought
            // rather than claiming a clean one.
            IntegratingInstall();
            VesselViewProvider.SetTrajectoryArcSource(null);

            var orbit = VesselViewProvider.BuildOrbit(Snapshot());

            Assert.NotNull(orbit);
            Assert.Null(orbit!.Arc);
            Assert.Equal(TrajectoryRefusal.NotAttempted, orbit.ArcRefusal);
        }
    }
}
