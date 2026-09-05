using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// That the simulation cut is actually WIRED, not merely implemented.
    ///
    /// <para><c>SimulationDelayPolicy</c> is unit-tested in
    /// <c>Sitrep.Host.Tests</c> against a stand-in backend, and passing there
    /// proves the rule and nothing about whether anything calls it. The rule
    /// reaches an operator through exactly one accessor,
    /// <c>CommsCoreUplink.SignalDelayConfig</c>, which the reveal gate, the
    /// <c>comms.delay</c> channel, every fleet vessel's light-time, the
    /// command-centre delay pass and the currency reveal deadline all read. If
    /// that accessor were still handing out the authored config, every one of
    /// those tests would still pass and no delay would ever be cut.</para>
    ///
    /// <para>Drives the real <see cref="CommsCoreUplink.Register"/> against a
    /// no-op host, because the kernel the policy reads is bound THERE and
    /// binding it is the thing that could be forgotten.</para>
    /// </summary>
    [Collection(CommsCoreUplinkStatics.Name)]
    public class SimulationDelayWiringTests
    {
        private sealed class SimulatedFlightBackend : ISimulationBackend
        {
            private readonly bool? _simulated;

            public SimulatedFlightBackend(bool? simulated)
            {
                _simulated = simulated;
            }

            public string ProviderId => "test-sim";

            public bool? IsSimulatedFlight() => _simulated;
        }

        private static Kernel KernelSaying(bool? simulated)
        {
            var kernel = new Kernel();
            SimulationElection.RegisterCapability(kernel);
            if (simulated != null)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = SimulationElection.CapabilityId,
                    Id = "test-sim",
                    Priority = 10.0,
                    Factory = _ => new SimulatedFlightBackend(simulated),
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        /// <summary>
        /// The shared accessor is EFFECTIVE, not authored. Every delay reader
        /// in the mod goes through it, so this one assertion is what makes them
        /// cut together instead of leaving a board whose telemetry is live and
        /// whose money still arrives late.
        /// </summary>
        [Fact]
        public void TheSharedDelayAccessorCutsForASimulation()
        {
            WithDelayOn(() =>
            {
                CommsCoreUplink.ConfigureSimulationKernel(KernelSaying(true));

                Assert.False(CommsCoreUplink.SignalDelayConfig.Enabled);
                Assert.True(CommsCoreUplink.SignalDelayConfig.CutForSimulation);
                // The authored config is untouched: the cut is a derivation for
                // as long as the rehearsal lasts, never an edit that would
                // leave delay off once it ended.
                Assert.True(CommsCoreUplink.AuthoredSignalDelayConfig.Enabled);
            });
        }

        [Fact]
        public void TheSharedDelayAccessorLeavesAMissionAlone()
        {
            WithDelayOn(() =>
            {
                CommsCoreUplink.ConfigureSimulationKernel(KernelSaying(false));

                Assert.True(CommsCoreUplink.SignalDelayConfig.Enabled);
            });
        }

        /// <summary>
        /// A stock install elects the vanilla, which declines to answer, and
        /// nothing is cut. This is the case that would silently disable signal
        /// delay for every player who has never heard of RP-1.
        /// </summary>
        [Fact]
        public void AGameWithNoSimulationsKeepsItsDelay()
        {
            WithDelayOn(() =>
            {
                CommsCoreUplink.ConfigureSimulationKernel(KernelSaying(null));

                Assert.True(CommsCoreUplink.SignalDelayConfig.Enabled);
            });
        }

        [Fact]
        public void NoKernelAtAllKeepsTheDelay()
        {
            WithDelayOn(() =>
            {
                CommsCoreUplink.ConfigureSimulationKernel(null);

                Assert.True(CommsCoreUplink.SignalDelayConfig.Enabled);
            });
        }

        /// <summary>
        /// The command an operator's settings row sends. Applying delay during
        /// a simulation restores it while the rehearsal is still running.
        /// </summary>
        [Fact]
        public void TheCommandTurnsTheCutOffAndBackOn()
        {
            WithDelayOn(() =>
            {
                CommsCoreUplink.ConfigureSimulationKernel(KernelSaying(true));
                Assert.False(CommsCoreUplink.SignalDelayConfig.Enabled);

                var applied = CommsCoreUplink.SetSimulationDelayPolicy(
                    new SetSimulationDelayPolicyArgs { ApplyDuringSimulation = true });

                Assert.True(applied.Success);
                Assert.True(CommsCoreUplink.SignalDelayConfig.Enabled);

                var cutAgain = CommsCoreUplink.SetSimulationDelayPolicy(
                    new SetSimulationDelayPolicyArgs { ApplyDuringSimulation = false });

                Assert.True(cutAgain.Success);
                Assert.False(CommsCoreUplink.SignalDelayConfig.Enabled);
            });
        }

        [Fact]
        public void TheCommandRefusesArgumentsItCannotRead()
        {
            WithDelayOn(() =>
            {
                Assert.False(CommsCoreUplink.SetSimulationDelayPolicy(null).Success);
            });
        }

        /// <summary>
        /// The config and the kernel behind the accessor are process statics,
        /// so a case that left either set would change the answer for whatever
        /// ran next. Restores both, whatever the body does.
        /// </summary>
        private static void WithDelayOn(System.Action body)
        {
            var authored = CommsCoreUplink.AuthoredSignalDelayConfig;
            try
            {
                CommsCoreUplink.ConfigureSignalDelay(new SignalDelayConfig
                {
                    Enabled = true,
                    LightSpeedScale = 1.0,
                });
                body();
            }
            finally
            {
                CommsCoreUplink.ConfigureSimulationKernel(null);
                CommsCoreUplink.ConfigureSignalDelay(authored);
            }
        }
    }
}
