using System;
using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The occlusion model as a DECLARED property of the elected comms backend.
    ///
    /// <para>The thing under test is a disagreement. Stock CommNet shrinks a
    /// body before testing a radio path against it (0.9x airless, 0.75x with an
    /// atmosphere); a bare-radius backend does not. For
    /// Kerbin that is a 450 km occluder versus a 600 km one, roughly eleven
    /// minutes of difference in a predicted low-orbit blackout, so a consumer
    /// that picks the wrong one is not slightly off, it is wrong. These tests pin
    /// stock's declaration below the bare radius and prove a consumer reads
    /// whichever model won the election without knowing who won.</para>
    ///
    /// <para>Stock's declaration is the REAL one: this project compiles
    /// <c>CommNetOcclusion</c> straight out of its backend (see the .csproj), so
    /// a change to it shows up here rather than in a re-stated constant that
    /// could drift. The competing bare-radius model is planted from the
    /// contract's own <see cref="ScaledRadiusOcclusionModel"/>; an Uplink that
    /// declares a bare-radius model pins it in that Uplink's own tests.</para>
    /// </summary>
    public class CommsOcclusionTests
    {
        // Kerbin and the Mun: one body with an atmosphere and one without, which
        // is the only axis any backend currently discriminates on.
        private const double KerbinRadiusMeters = 600_000.0;
        private const double MunRadiusMeters = 200_000.0;

        private const string BareRadiusModelId = "planted-bare-radius";

        private static ICommsOcclusionModel Stock() => CommNetOcclusion.StockDefaults();

        /// <summary>The competitor stock's declaration is measured against: occludes at the bare radius, whatever the atmosphere.</summary>
        private static ICommsOcclusionModel BareRadius() =>
            new ScaledRadiusOcclusionModel(BareRadiusModelId, "Planted (bare body radius)", 1.0, 1.0);

        // ---------------------------------------------------------------
        // The disagreement itself.
        // ---------------------------------------------------------------

        [Fact]
        public void AtmosphericBody_StockOccludesSmallerThanTheBareRadius()
        {
            var stock = Stock().OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: true);

            Assert.Equal(450_000.0, stock, 6);
            Assert.True(stock < KerbinRadiusMeters, "stock's atmospheric multiplier must shrink its occluder below the bare radius");
        }

        [Fact]
        public void AirlessBody_StockOccludesSmallerThanTheBareRadius()
        {
            var stock = Stock().OccludingRadiusMeters(MunRadiusMeters, hasAtmosphere: false);

            Assert.Equal(180_000.0, stock, 6);
            Assert.True(stock < MunRadiusMeters, "stock's vacuum multiplier must shrink its occluder below the bare radius");
        }

        /// <summary>
        /// The reason the model takes an atmosphere flag at all: stock answers
        /// differently for the same rock depending on whether it has air, and a
        /// per-body resolved radius is the only shape that can carry that
        /// without the consumer knowing the rule.
        /// </summary>
        [Fact]
        public void Stock_DiscriminatesOnAtmosphere()
        {
            var model = Stock();

            var airless = model.OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: false);
            var withAir = model.OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: true);

            Assert.True(withAir < airless, "an atmosphere must shrink stock's occluder further than vacuum does");
        }

        [Fact]
        public void Stock_CarriesItsOwnName()
        {
            Assert.Equal("commnet-scaled-radius", Stock().ModelId);
            Assert.False(string.IsNullOrWhiteSpace(Stock().ModelName));
        }

        /// <summary>
        /// The multipliers are a per-save difficulty setting, not constants: the
        /// presets range from 0/0 (nothing occludes) to 1/1 (everything occludes
        /// bare, i.e. a bare-radius backend's geometry reached by a stock route).
        /// A model built from live parameters must honour them.
        /// </summary>
        [Fact]
        public void Stock_HonoursLiveMultipliers()
        {
            var nothingOccludes = CommNetOcclusion.Model(0.0, 0.0);
            var everythingOccludes = CommNetOcclusion.Model(1.0, 1.0);

            Assert.Equal(0.0, nothingOccludes.OccludingRadiusMeters(KerbinRadiusMeters, true), 6);
            Assert.Equal(KerbinRadiusMeters, everythingOccludes.OccludingRadiusMeters(KerbinRadiusMeters, true), 6);
        }

        [Theory]
        [InlineData(double.NaN)]
        [InlineData(double.PositiveInfinity)]
        [InlineData(-1.0)]
        public void NonFiniteMultiplier_FallsBackToBareRadius(double multiplier)
        {
            // A NaN occluding radius fails every comparison downstream and so
            // reads as "never occluded"; the bare radius is the conservative
            // substitute (longest predicted blackout, never a promise of contact
            // that isn't there).
            var model = CommNetOcclusion.Model(multiplier, multiplier);

            Assert.Equal(KerbinRadiusMeters, model.OccludingRadiusMeters(KerbinRadiusMeters, true), 6);
            Assert.Equal(KerbinRadiusMeters, model.OccludingRadiusMeters(KerbinRadiusMeters, false), 6);
        }

        [Theory]
        [InlineData(double.NaN)]
        [InlineData(0.0)]
        [InlineData(-5.0)]
        public void NonPositiveRadius_OccludesNothing(double radius)
        {
            Assert.Equal(0.0, Stock().OccludingRadiusMeters(radius, true), 6);
            Assert.Equal(0.0, Stock().OccludingRadiusMeters(radius, false), 6);
        }

        // ---------------------------------------------------------------
        // The consumer-side read: whoever is elected, one shape.
        // ---------------------------------------------------------------

        private sealed class StubBackend : ICommsBackend
        {

        public bool? StillCarriesTo(string nodeId) => null;
            private readonly Func<ICommsOcclusionModel> _occlusion;

            public StubBackend(string id, Func<ICommsOcclusionModel> occlusion)
            {
                ProviderId = id;
                _occlusion = occlusion;
            }

            public string ProviderId { get; }
            public CommsConnectivity Connectivity() => new CommsConnectivity();
            public CommsSignal SignalStrength() => new CommsSignal();
            public CommsControl ControlState() => new CommsControl();
            public CommsPath Path() => new CommsPath();
            public CommsNetwork Network() => new CommsNetwork();
            /// <summary>Nothing here routes: this stub exists for the occlusion read.</summary>
            public IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to) => null;
            public ICommsReachModel ReachModel(object? from, object? to) => CommsReachModels.Unknown;
            public object? ControlPathTerminus() => null;
            public ICommsOcclusionModel OcclusionModel() => _occlusion();

            public ICommsDegradeModel DegradeModel() => CommsDegradeModels.Unknown;
        }

        private static Kernel ResolvedKernel(bool bareRadiusBackendPresent)
        {
            var kernel = new Kernel();
            CommsElection.RegisterCapability(
                kernel,
                _ => new StubBackend(CommNetBackendId, () => CommNetOcclusion.StockDefaults()));
            if (bareRadiusBackendPresent)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = CommsElection.CapabilityId,
                    Id = BareRadiusBackendId,
                    Priority = 100.0,
                    Factory = _ => new StubBackend(BareRadiusBackendId, BareRadius),
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        private const string CommNetBackendId = "commnet";

        private const string BareRadiusBackendId = "planted-bare-radius-backend";

        [Fact]
        public void CommNetElected_ConsumerReadsStockGeometry()
        {
            var model = CommsElection.OcclusionModel(ResolvedKernel(bareRadiusBackendPresent: false));

            Assert.Equal(CommNetOcclusion.ModelId, model.ModelId);
            Assert.Equal(450_000.0, model.OccludingRadiusMeters(KerbinRadiusMeters, true), 6);
        }

        [Fact]
        public void BareRadiusBackendElected_ConsumerReadsBareRadiusGeometry()
        {
            var model = CommsElection.OcclusionModel(ResolvedKernel(bareRadiusBackendPresent: true));

            Assert.Equal(BareRadiusModelId, model.ModelId);
            Assert.Equal(KerbinRadiusMeters, model.OccludingRadiusMeters(KerbinRadiusMeters, true), 6);
        }

        /// <summary>
        /// The whole point of the seam: the SAME consumer call yields different
        /// geometry purely because a different provider won, with no branch on
        /// which mod is installed anywhere in the call.
        /// </summary>
        [Fact]
        public void SameConsumerCall_DiffersOnlyByWhoWasElected()
        {
            var stockElected = CommsElection.OcclusionModel(ResolvedKernel(bareRadiusBackendPresent: false))
                .OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: true);
            var bareRadiusElected = CommsElection.OcclusionModel(ResolvedKernel(bareRadiusBackendPresent: true))
                .OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: true);

            Assert.True(stockElected < bareRadiusElected);
        }

        [Fact]
        public void NoKernel_YieldsUnknownModel()
        {
            var model = CommsElection.OcclusionModel(null);

            Assert.Equal(CommsOcclusionModels.UnknownModelId, model.ModelId);
            // Conservative: the bare radius, the largest occluder any real
            // backend uses, so a predictor built on it under-promises contact.
            Assert.Equal(KerbinRadiusMeters, model.OccludingRadiusMeters(KerbinRadiusMeters, true), 6);
        }

        [Fact]
        public void UnresolvedCapability_YieldsUnknownModel()
        {
            // Registered but never resolved: Query has no active instance.
            var kernel = new Kernel();
            CommsElection.RegisterCapability(
                kernel,
                _ => new StubBackend(CommNetBackendId, () => CommNetOcclusion.StockDefaults()));

            var model = CommsElection.OcclusionModel(kernel);

            Assert.Equal(CommsOcclusionModels.UnknownModelId, model.ModelId);
        }

        [Fact]
        public void BackendThatThrows_YieldsUnknownModel_DoesNotPropagate()
        {
            var kernel = new Kernel();
            CommsElection.RegisterCapability(
                kernel,
                _ => new StubBackend("broken", () => throw new InvalidOperationException("boom")));
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });

            var model = CommsElection.OcclusionModel(kernel);

            Assert.Equal(CommsOcclusionModels.UnknownModelId, model.ModelId);
        }

        // ---------------------------------------------------------------
        // The wire payload: the model applied to the snapshot's body list.
        // ---------------------------------------------------------------

        private static KspSnapshot SnapshotWithBodies() => new KspSnapshot
        {
            Ut = 1234.0,
            Values = new Dictionary<string, object?>
            {
                ["bodies"] = new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["name"] = "Kerbin",
                        ["index"] = 1,
                        ["radius"] = KerbinRadiusMeters,
                        ["hasAtmosphere"] = true,
                    },
                    new Dictionary<string, object?>
                    {
                        ["name"] = "Mun",
                        ["index"] = 2,
                        ["radius"] = MunRadiusMeters,
                        ["hasAtmosphere"] = false,
                    },
                },
            },
        };

        [Fact]
        public void Payload_ResolvesEveryBodyThroughTheElectedModel()
        {
            var stock = CommsOcclusionBuilder.Build(Stock(), SnapshotWithBodies());
            var bare = CommsOcclusionBuilder.Build(BareRadius(), SnapshotWithBodies());

            var stockKerbin = stock.Bodies.Single(b => b.Name == "Kerbin");
            var bareKerbin = bare.Bodies.Single(b => b.Name == "Kerbin");

            // The bare radius rides alongside the resolved one, so the
            // assumption stays derivable without the consumer applying anything.
            Assert.Equal(KerbinRadiusMeters, stockKerbin.RadiusMeters, 6);
            Assert.Equal(450_000.0, stockKerbin.OccludingRadiusMeters, 6);
            Assert.Equal(KerbinRadiusMeters, bareKerbin.OccludingRadiusMeters, 6);

            var stockMun = stock.Bodies.Single(b => b.Name == "Mun");
            Assert.False(stockMun.HasAtmosphere);
            Assert.Equal(180_000.0, stockMun.OccludingRadiusMeters, 6);
            Assert.Equal(MunRadiusMeters, bare.Bodies.Single(b => b.Name == "Mun").OccludingRadiusMeters, 6);
        }

        [Fact]
        public void Payload_NamesTheModelInPlay()
        {
            var model = BareRadius();
            var payload = CommsOcclusionBuilder.Build(model, SnapshotWithBodies());

            Assert.Equal(model.ModelId, payload.ModelId);
            Assert.Equal(model.ModelName, payload.ModelName);
        }

        /// <summary>Body index matches <c>system.bodies</c>' own, so a consumer joins the two without name-matching.</summary>
        [Fact]
        public void Payload_CarriesTheSystemBodiesIndex()
        {
            var payload = CommsOcclusionBuilder.Build(Stock(), SnapshotWithBodies());

            Assert.Equal(1, payload.Bodies.Single(b => b.Name == "Kerbin").Index);
            Assert.Equal(2, payload.Bodies.Single(b => b.Name == "Mun").Index);
        }

        [Fact]
        public void Payload_NoBodiesYet_StillNamesTheModel()
        {
            var payload = CommsOcclusionBuilder.Build(Stock(), new KspSnapshot());

            Assert.Equal(CommNetOcclusion.ModelId, payload.ModelId);
            Assert.Empty(payload.Bodies);
        }

        [Fact]
        public void Payload_NullSnapshotAndNullModel_FailSoft()
        {
            var payload = CommsOcclusionBuilder.Build(null, null);

            Assert.Equal(CommsOcclusionModels.UnknownModelId, payload.ModelId);
            Assert.Empty(payload.Bodies);
        }

        // ---------------------------------------------------------------
        // Change detection: what keeps a near-static body list off the wire.
        // ---------------------------------------------------------------

        [Fact]
        public void SameDeclaration_TwoIdenticalBuilds_AreTheSameDeclaration()
        {
            Assert.True(CommsOcclusionBuilder.SameDeclaration(
                CommsOcclusionBuilder.Build(Stock(), SnapshotWithBodies()),
                CommsOcclusionBuilder.Build(Stock(), SnapshotWithBodies())));
        }

        [Fact]
        public void SameDeclaration_DifferentElectedModel_IsAChange()
        {
            Assert.False(CommsOcclusionBuilder.SameDeclaration(
                CommsOcclusionBuilder.Build(Stock(), SnapshotWithBodies()),
                CommsOcclusionBuilder.Build(BareRadius(), SnapshotWithBodies())));
        }

        /// <summary>
        /// The player moving the occlusion multipliers mid-session changes the
        /// resolved radii without changing the model's name, so identity alone
        /// would miss it.
        /// </summary>
        [Fact]
        public void SameDeclaration_SameModelIdDifferentMultipliers_IsAChange()
        {
            Assert.False(CommsOcclusionBuilder.SameDeclaration(
                CommsOcclusionBuilder.Build(CommNetOcclusion.Model(0.9, 0.75), SnapshotWithBodies()),
                CommsOcclusionBuilder.Build(CommNetOcclusion.Model(0.5, 0.5), SnapshotWithBodies())));
        }

        [Fact]
        public void SameDeclaration_DifferentBodySet_IsAChange()
        {
            Assert.False(CommsOcclusionBuilder.SameDeclaration(
                CommsOcclusionBuilder.Build(Stock(), SnapshotWithBodies()),
                CommsOcclusionBuilder.Build(Stock(), new KspSnapshot())));
        }
    }
}
