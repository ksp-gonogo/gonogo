using System;
using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP;
using Gonogo.RealAntennasUplink;
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
    /// atmosphere); RealAntennas tests against the bare radius. For Kerbin that
    /// is a 450 km occluder versus a 600 km one, roughly eleven minutes of
    /// difference in a predicted low-orbit blackout, so a consumer that picks
    /// the wrong one is not slightly off, it is wrong. These tests pin the two
    /// declarations against each other and prove a consumer reads whichever one
    /// won the election without knowing who won.</para>
    ///
    /// <para>Both declarations are the REAL ones: this project compiles
    /// <c>CommNetOcclusion</c> and <c>RaOcclusion</c> straight out of their
    /// backends (see the .csproj), so a change to either shows up here rather
    /// than in a re-stated constant that could drift.</para>
    /// </summary>
    public class CommsOcclusionTests
    {
        // Kerbin and the Mun: one body with an atmosphere and one without, which
        // is the only axis any backend currently discriminates on.
        private const double KerbinRadiusMeters = 600_000.0;
        private const double MunRadiusMeters = 200_000.0;

        private static ICommsOcclusionModel Stock() => CommNetOcclusion.StockDefaults();

        private static ICommsOcclusionModel RealAntennas() => RaOcclusion.Model;

        // ---------------------------------------------------------------
        // The disagreement itself.
        // ---------------------------------------------------------------

        [Fact]
        public void AtmosphericBody_StockOccludesSmallerThanRealAntennas()
        {
            var stock = Stock().OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: true);
            var ra = RealAntennas().OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: true);

            Assert.Equal(450_000.0, stock, 6);
            Assert.Equal(KerbinRadiusMeters, ra, 6);
            Assert.True(stock < ra, "stock's atmospheric multiplier must make its occluder the smaller of the two");
        }

        [Fact]
        public void AirlessBody_StockOccludesSmallerThanRealAntennas()
        {
            var stock = Stock().OccludingRadiusMeters(MunRadiusMeters, hasAtmosphere: false);
            var ra = RealAntennas().OccludingRadiusMeters(MunRadiusMeters, hasAtmosphere: false);

            Assert.Equal(180_000.0, stock, 6);
            Assert.Equal(MunRadiusMeters, ra, 6);
            Assert.True(stock < ra, "stock's vacuum multiplier must make its occluder the smaller of the two");
        }

        [Fact]
        public void RealAntennas_IgnoresAtmosphere()
        {
            var model = RealAntennas();

            Assert.Equal(
                model.OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: false),
                model.OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: true),
                6);
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
        public void ModelsCarryDistinctNames()
        {
            Assert.Equal("commnet-scaled-radius", Stock().ModelId);
            Assert.Equal("realantennas-bare-radius", RealAntennas().ModelId);
            Assert.NotEqual(Stock().ModelId, RealAntennas().ModelId);
            Assert.False(string.IsNullOrWhiteSpace(Stock().ModelName));
            Assert.False(string.IsNullOrWhiteSpace(RealAntennas().ModelName));
        }

        /// <summary>
        /// The multipliers are a per-save difficulty setting, not constants: the
        /// presets range from 0/0 (nothing occludes) to 1/1 (everything occludes
        /// bare, i.e. RA's geometry reached by a stock route). A model built from
        /// live parameters must honour them.
        /// </summary>
        [Fact]
        public void Stock_HonoursLiveMultipliers()
        {
            var nothingOccludes = CommNetOcclusion.Model(0.0, 0.0);
            var everythingOccludes = CommNetOcclusion.Model(1.0, 1.0);

            Assert.Equal(0.0, nothingOccludes.OccludingRadiusMeters(KerbinRadiusMeters, true), 6);
            Assert.Equal(
                RealAntennas().OccludingRadiusMeters(KerbinRadiusMeters, true),
                everythingOccludes.OccludingRadiusMeters(KerbinRadiusMeters, true),
                6);
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
            Assert.Equal(0.0, RealAntennas().OccludingRadiusMeters(radius, false), 6);
        }

        // ---------------------------------------------------------------
        // The consumer-side read: whoever is elected, one shape.
        // ---------------------------------------------------------------

        private sealed class StubBackend : ICommsBackend
        {
            private readonly Func<ICommsOcclusionModel> _occlusion;

            public StubBackend(string id, Func<ICommsOcclusionModel> occlusion)
            {
                ProviderId = id;
                _occlusion = occlusion;
            }

            public string ProviderId { get; }
            public CommsConnectivity Connectivity() => new CommsConnectivity();
            public CommsSignalStrength SignalStrength() => new CommsSignalStrength();
            public CommsControlState ControlState() => new CommsControlState();
            public CommsPath Path() => new CommsPath();
            public CommsNetwork Network() => new CommsNetwork();
            public ICommsOcclusionModel OcclusionModel() => _occlusion();
        }

        private static Kernel ResolvedKernel(bool raPresent)
        {
            var kernel = new Kernel();
            CommsElection.RegisterCapability(
                kernel,
                _ => new StubBackend(CommNetBackendId, () => CommNetOcclusion.StockDefaults()));
            if (raPresent)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = CommsElection.CapabilityId,
                    Id = "realantennas",
                    Priority = 100.0,
                    Factory = _ => new StubBackend("realantennas", () => RaOcclusion.Model),
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        private const string CommNetBackendId = "commnet";

        [Fact]
        public void CommNetElected_ConsumerReadsStockGeometry()
        {
            var model = CommsElection.OcclusionModel(ResolvedKernel(raPresent: false));

            Assert.Equal(CommNetOcclusion.ModelId, model.ModelId);
            Assert.Equal(450_000.0, model.OccludingRadiusMeters(KerbinRadiusMeters, true), 6);
        }

        [Fact]
        public void RealAntennasElected_ConsumerReadsBareRadiusGeometry()
        {
            var model = CommsElection.OcclusionModel(ResolvedKernel(raPresent: true));

            Assert.Equal(RaOcclusion.ModelId, model.ModelId);
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
            var withoutRa = CommsElection.OcclusionModel(ResolvedKernel(raPresent: false))
                .OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: true);
            var withRa = CommsElection.OcclusionModel(ResolvedKernel(raPresent: true))
                .OccludingRadiusMeters(KerbinRadiusMeters, hasAtmosphere: true);

            Assert.True(withoutRa < withRa);
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
            var ra = CommsOcclusionBuilder.Build(RealAntennas(), SnapshotWithBodies());

            var stockKerbin = stock.Bodies.Single(b => b.Name == "Kerbin");
            var raKerbin = ra.Bodies.Single(b => b.Name == "Kerbin");

            // The bare radius rides alongside the resolved one, so the
            // assumption stays derivable without the consumer applying anything.
            Assert.Equal(KerbinRadiusMeters, stockKerbin.RadiusMeters, 6);
            Assert.Equal(450_000.0, stockKerbin.OccludingRadiusMeters, 6);
            Assert.Equal(KerbinRadiusMeters, raKerbin.OccludingRadiusMeters, 6);

            var stockMun = stock.Bodies.Single(b => b.Name == "Mun");
            Assert.False(stockMun.HasAtmosphere);
            Assert.Equal(180_000.0, stockMun.OccludingRadiusMeters, 6);
            Assert.Equal(MunRadiusMeters, ra.Bodies.Single(b => b.Name == "Mun").OccludingRadiusMeters, 6);
        }

        [Fact]
        public void Payload_NamesTheModelInPlay()
        {
            var payload = CommsOcclusionBuilder.Build(RealAntennas(), SnapshotWithBodies());

            Assert.Equal(RaOcclusion.ModelId, payload.ModelId);
            Assert.Equal(RaOcclusion.ModelName, payload.ModelName);
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
                CommsOcclusionBuilder.Build(RealAntennas(), SnapshotWithBodies())));
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
