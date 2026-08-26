using System;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Host.Flight;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The simulation election, the delay it cuts, and what a client is told
    /// about both.
    ///
    /// <para>The fact under test is that a REHEARSAL is not a mission. RP-1's
    /// simulations put a whole flight on the board (altitude, stage, crew,
    /// fuel, a countdown) which is not happening, and until this existed the
    /// wire reported one exactly as it reported the other. Two consequences
    /// follow and both are pinned here: a client can say which it is, and the
    /// light-time to a spacecraft that does not exist is not enforced.</para>
    /// </summary>
    public class SimulationDelayTests
    {
        private sealed class FakeSimulationBackend : ISimulationBackend
        {
            private readonly bool? _simulated;

            public FakeSimulationBackend(bool? simulated)
            {
                _simulated = simulated;
            }

            public string ProviderId => "fake-sim";

            public bool? IsSimulatedFlight() => _simulated;
        }

        private sealed class ThrowingSimulationBackend : ISimulationBackend
        {
            public string ProviderId => "throwing";

            public bool? IsSimulatedFlight() => throw new InvalidOperationException("reflection walk blew up");
        }

        private static SignalDelayConfig DelayOn(bool delayInSimulation = false) =>
            new SignalDelayConfig
            {
                Enabled = true,
                LightSpeedScale = 1.0,
                DelayInSimulation = delayInSimulation,
            };

        private static Kernel ResolvedKernel(ISimulationBackend? provider)
        {
            var kernel = new Kernel();
            SimulationElection.RegisterCapability(kernel);
            if (provider != null)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = SimulationElection.CapabilityId,
                    Id = provider.ProviderId,
                    Priority = 10.0,
                    Factory = _ => provider,
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        // ---- election ----

        [Fact]
        public void NoProvider_VanillaWinsAndDeclinesToAnswer()
        {
            var elected = SimulationElection.Elected(ResolvedKernel(null));

            Assert.NotNull(elected);
            Assert.Equal("stock", elected!.ProviderId);
            // Null, not false. Stock has no rehearsal mode, so "is this a
            // simulation" does not apply rather than answering no.
            Assert.Null(elected.IsSimulatedFlight());
        }

        [Fact]
        public void ProviderPresent_ProviderWins()
        {
            var elected = SimulationElection.Elected(ResolvedKernel(new FakeSimulationBackend(true)));

            Assert.Equal("fake-sim", elected!.ProviderId);
            Assert.True(elected.IsSimulatedFlight());
        }

        [Fact]
        public void UnresolvedKernel_ReadsAsNobodyHasSaid()
        {
            Assert.Null(SimulationElection.Elected(null));
        }

        // ---- the cut ----

        /// <summary>
        /// The headline. A rehearsal has no spacecraft, so there is no
        /// light-time to enforce, and the config every delay reader shares
        /// comes back disabled.
        /// </summary>
        [Fact]
        public void SimulatedFlight_CutsTheDelay()
        {
            var effective = SimulationDelayPolicy.Effective(
                DelayOn(), new FakeSimulationBackend(true));

            Assert.False(effective.Enabled);
            Assert.True(effective.CutForSimulation);
        }

        [Fact]
        public void RealMission_LeavesTheDelayAlone()
        {
            var authored = DelayOn();

            var effective = SimulationDelayPolicy.Effective(
                authored, new FakeSimulationBackend(false));

            Assert.Same(authored, effective);
            Assert.True(effective.Enabled);
        }

        /// <summary>
        /// A stock game must not be treated as one long simulation. Null is
        /// "no such concept", and collapsing it to true would cut the delay for
        /// every stock player at once.
        /// </summary>
        [Fact]
        public void NoConceptOfASimulation_LeavesTheDelayAlone()
        {
            var authored = DelayOn();

            Assert.Same(authored, SimulationDelayPolicy.Effective(authored, new FakeSimulationBackend(null)));
            Assert.Same(authored, SimulationDelayPolicy.Effective(authored, null));
        }

        /// <summary>
        /// The operator asked to rehearse under real conditions. Their choice
        /// wins over the default, which is the whole reason it is a setting.
        /// </summary>
        [Fact]
        public void OperatorAskedForDelayInSimulation_KeepsIt()
        {
            var authored = DelayOn(delayInSimulation: true);

            var effective = SimulationDelayPolicy.Effective(
                authored, new FakeSimulationBackend(true));

            Assert.Same(authored, effective);
            Assert.True(effective.Enabled);
        }

        [Fact]
        public void DelayAlreadyOff_StaysOffWithoutClaimingASimulationCutIt()
        {
            var authored = SignalDelayConfig.Off();

            var effective = SimulationDelayPolicy.Effective(
                authored, new FakeSimulationBackend(true));

            Assert.False(effective.Enabled);
            Assert.False(effective.CutForSimulation);
        }

        /// <summary>
        /// This runs on the path of every delay read in the mod, the Courier's
        /// included. A reflection walk into a mod nobody here has a copy of
        /// must not take that path down.
        /// </summary>
        [Fact]
        public void ThrowingBackend_LeavesTheDelayAlone()
        {
            var authored = DelayOn();

            Assert.Same(authored, SimulationDelayPolicy.Effective(authored, new ThrowingSimulationBackend()));
        }

        /// <summary>
        /// The light-speed scale and the silence deadline are the operator's
        /// configuration, not the simulation's business: a derived config that
        /// dropped them would restore the wrong delay the moment the rehearsal
        /// ended.
        /// </summary>
        [Fact]
        public void TheCutPreservesEverythingElseTheOperatorConfigured()
        {
            var authored = new SignalDelayConfig
            {
                Enabled = true,
                LightSpeedScale = 0.25,
                SilenceDeclarationSeconds = 1234.0,
            };

            var effective = SimulationDelayPolicy.Effective(
                authored, new FakeSimulationBackend(true));

            Assert.Equal(0.25, effective.LightSpeedScale);
            Assert.Equal(1234.0, effective.SilenceDeclarationSeconds);
        }

        // ---- what comms.delay says ----

        /// <summary>
        /// Zero is the same number either way, and the reason is not. "Delay is
        /// not configured" and "delay is off because this is a rehearsal" call
        /// for different reactions from an operator looking at a live board.
        /// </summary>
        [Fact]
        public void ComputeReportsASimulationCutAsItsOwnReason()
        {
            var cut = SimulationDelayPolicy.Effective(DelayOn(), new FakeSimulationBackend(true));

            var delay = SignalDelay.Compute(cut, PathOfOneHop(384_400_000.0), "sim", Quality.Loaded);

            Assert.Equal(0.0, delay.OneWaySeconds);
            Assert.Equal(CommsDelaySource.Simulation, delay.Source);
        }

        [Fact]
        public void ComputeStillReportsAPlainDisabledDelayAsNone()
        {
            var delay = SignalDelay.Compute(
                SignalDelayConfig.Off(), PathOfOneHop(384_400_000.0), "off", Quality.Loaded);

            Assert.Equal(0.0, delay.OneWaySeconds);
            Assert.Equal(CommsDelaySource.None, delay.Source);
        }

        [Fact]
        public void ARealMissionStillMeasuresItsLightTime()
        {
            var effective = SimulationDelayPolicy.Effective(DelayOn(), new FakeSimulationBackend(false));

            var delay = SignalDelay.Compute(effective, PathOfOneHop(299_792_458.0), "real", Quality.Loaded);

            Assert.Equal(CommsDelaySource.SignalDelay, delay.Source);
            Assert.Equal(1.0, delay.OneWaySeconds!.Value, 6);
        }

        // ---- flight.simulation ----

        [Fact]
        public void FlightSimulationSaysNothingWhenTheGameHasNoSuchConcept()
        {
            Assert.Null(FlightSimulationProvider.Build(new FakeSimulationBackend(null), DelayOn()));
            Assert.Null(FlightSimulationProvider.Build(null, DelayOn()));
            Assert.Null(FlightSimulationProvider.Build(new ThrowingSimulationBackend(), DelayOn()));
        }

        [Fact]
        public void FlightSimulationReportsARehearsalAndTheCutTogether()
        {
            var payload = FlightSimulationProvider.Build(new FakeSimulationBackend(true), DelayOn());

            Assert.NotNull(payload);
            Assert.True(payload!.Simulated);
            Assert.False(payload.DelayApplied);
            Assert.False(payload.DelayInSimulation);
        }

        [Fact]
        public void FlightSimulationReportsAMissionWithItsDelayIntact()
        {
            var payload = FlightSimulationProvider.Build(new FakeSimulationBackend(false), DelayOn());

            Assert.NotNull(payload);
            Assert.False(payload!.Simulated);
            Assert.True(payload.DelayApplied);
        }

        /// <summary>
        /// The row an operator flips reads THIS, so it has to report what the
        /// mod is doing rather than what a console once asked for.
        /// </summary>
        [Fact]
        public void FlightSimulationCarriesTheStandingChoiceBack()
        {
            var payload = FlightSimulationProvider.Build(
                new FakeSimulationBackend(true), DelayOn(delayInSimulation: true));

            Assert.True(payload!.DelayInSimulation);
            Assert.True(payload.DelayApplied);
        }

        private static CommsPath PathOfOneHop(double metres) => new CommsPath
        {
            Hops = new[] { new CommsHop { DistanceMeters = metres } },
            Meta = new PayloadMeta { Source = "test", Quality = Quality.Loaded },
        };
    }
}
