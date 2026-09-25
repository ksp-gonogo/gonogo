using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Host.Settings;
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
        /// The press reaches the FILE, and the file says so.
        ///
        /// <para>This is the assertion the suite lacked. The command was
        /// already exercised here, but its write resolved its own path from
        /// <c>KSPUtil.ApplicationRootPath</c>, which reads a live Unity player,
        /// so headlessly the whole body threw into a catch that logged and
        /// returned. Every case above passed whether or not a byte was ever
        /// written, and the persistence had only ever been observed by hand.</para>
        /// </summary>
        [Fact]
        public void TheCommandLandsInTheSettingsFile()
        {
            var directory = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(), "gonogo-delay-" + System.Guid.NewGuid().ToString("N"));
            var path = System.IO.Path.Combine(directory, "PluginData", "gonogo.cfg");
            try
            {
                WithDelayOn(
                    () =>
                    {
                        CommsCoreUplink.DeclareSimulationDelaySetting(CommsCoreUplink.DelaySettings);
                        var applied = CommsCoreUplink.SetSimulationDelayPolicy(
                            new SetSimulationDelayPolicyArgs { ApplyDuringSimulation = true });

                        Assert.True(applied.Success);
                        Assert.True(System.IO.File.Exists(path), path + " was never written");
                        Assert.Equal(
                            "// " + Gonogo.KSP.Settings.ConfigNodeSettingsStore.Header + "\n"
                            + "\n"
                            + "SIGNAL_DELAY\n"
                            + "{\n"
                            + "\tenabled = True // Apply light-time delay to commands and telemetry. True or False, default True\n"
                            + "\tlightSpeedScale = 1 // One-way light time as a fraction of c, where 1 is real light speed. A number, default 1\n"
                            + "}\n"
                            + "Uplinks\n"
                            + "{\n"
                            + "\trp1\n"
                            + "\t{\n"
                            + "\t\tdelayInSimulation = True // Apply the delay during a simulation as well as a real flight. True or False, default False\n"
                            + "\t}\n"
                            + "}\n",
                            System.IO.File.ReadAllText(path).Replace("\r\n", "\n"));
                    },
                    path);
            }
            finally
            {
                try
                {
                    if (System.IO.Directory.Exists(directory))
                    {
                        System.IO.Directory.Delete(directory, recursive: true);
                    }
                }
                catch (System.IO.IOException)
                {
                    // A temp directory the OS is still holding is not a test result.
                }
            }
        }

        /// <summary>
        /// The config, the kernel and the settings store behind the accessor
        /// are process statics, so a case that left any of them set would
        /// change the answer for whatever ran next. Restores all three, whatever
        /// the body does.
        ///
        /// <para>Passing a path binds the policy to a real settings file at
        /// that location; otherwise it gets an in-memory one, which applies
        /// every change and remembers none of it.</para>
        /// </summary>
        /// <summary>
        /// A save that kept the choice at its old top-level place has it carried
        /// into RP-1's block, so moving the setting does not reset it, and the
        /// old row is left in the file rather than deleted.
        /// </summary>
        [Fact]
        public void AChoiceSavedAtTheOldPlaceIsCarriedIntoRp1sBlock()
        {
            var seed = new SettingsDocument();
            seed.Set(CommsCoreUplink.LegacyDelayInSimulationRow, "True");
            WithStore(seed, store =>
            {
                CommsCoreUplink.DeclareSimulationDelaySetting(store);

                Assert.Equal("True", store.Text(CommsCoreUplink.DelayInSimulationRow));
                Assert.True(CommsCoreUplink.AuthoredSignalDelayConfig.DelayInSimulation);
                Assert.Equal("True", store.Text(CommsCoreUplink.LegacyDelayInSimulationRow));
            });
        }

        [Fact]
        public void AChoiceAlreadyInRp1sBlockIsNotOverwrittenByTheOldOne()
        {
            var seed = new SettingsDocument();
            seed.Set(CommsCoreUplink.LegacyDelayInSimulationRow, "True");
            seed.Set(CommsCoreUplink.DelayInSimulationRow, "False");
            WithStore(seed, store =>
            {
                CommsCoreUplink.DeclareSimulationDelaySetting(store);

                Assert.Equal("False", store.Text(CommsCoreUplink.DelayInSimulationRow));
                Assert.False(CommsCoreUplink.AuthoredSignalDelayConfig.DelayInSimulation);
            });
        }

        /// <summary>
        /// Without RP-1 there is no simulation to delay, so the choice is not
        /// offered: binding the delay settings declares no such row.
        /// </summary>
        [Fact]
        public void TheChoiceIsNotDeclaredUntilRp1IsRunning()
        {
            WithStore(new SettingsDocument(), store =>
            {
                Assert.DoesNotContain(
                    store.DeclaredRows,
                    row => row.Path == CommsCoreUplink.DelayInSimulationRow
                        || row.Path == CommsCoreUplink.LegacyDelayInSimulationRow);
            });
        }

        private static void WithStore(SettingsDocument seed, System.Action<SettingsStore> body)
        {
            var authored = CommsCoreUplink.AuthoredSignalDelayConfig;
            try
            {
                var store = new SettingsStore(new InMemorySettingsStore(seed));
                CommsCoreUplink.BindSettings(store);
                body(store);
            }
            finally
            {
                CommsCoreUplink.BindSettings(new SettingsStore(new InMemorySettingsStore()));
                CommsCoreUplink.ConfigureSignalDelay(authored);
            }
        }

        private static void WithDelayOn(System.Action body, string? settingsPath = null)
        {
            var authored = CommsCoreUplink.AuthoredSignalDelayConfig;
            try
            {
                CommsCoreUplink.BindSettings(new SettingsStore(
                    settingsPath == null
                        ? (ISettingsBackingStore)new InMemorySettingsStore()
                        : new Gonogo.KSP.Settings.ConfigNodeSettingsStore(settingsPath, _ => { })));
                body();
            }
            finally
            {
                CommsCoreUplink.ConfigureSimulationKernel(null);
                CommsCoreUplink.BindSettings(new SettingsStore(new InMemorySettingsStore()));
                CommsCoreUplink.ConfigureSignalDelay(authored);
            }
        }
    }
}
