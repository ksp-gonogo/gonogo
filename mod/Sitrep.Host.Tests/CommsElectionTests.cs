using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The comms backend election (comms-uplink-design.md §2) — the sharpest
    /// correctness risk the U2 brief flagged. Drives the REAL <see cref="Kernel"/>
    /// (byte-for-byte the TS reference port, golden-fixture-conformed) through
    /// the three cases: RA absent ⇒ CommNet vanilla; RA present ⇒ RA wins;
    /// and the elected instance is actually queryable as an
    /// <see cref="ICommsBackend"/>.
    /// </summary>
    public class CommsElectionTests
    {
        private sealed class FakeBackend : ICommsBackend
        {
            public FakeBackend(string id) => BackendId = id;
            public string BackendId { get; }
            public CommsConnectivity Connectivity() => new CommsConnectivity();
            public CommsSignalStrength SignalStrength() => new CommsSignalStrength();
            public CommsControlState ControlState() => new CommsControlState();
            public CommsPath Path() => new CommsPath();
            public CommsNetwork Network() => new CommsNetwork();
        }

        private static Kernel ResolvedKernel(bool raPresent)
        {
            var kernel = new Kernel();
            CommsElection.RegisterCapability(kernel, _ => new FakeBackend("commnet"));
            if (raPresent)
            {
                CommsElection.RegisterRealAntennasProvider(kernel, _ => new FakeBackend("realantennas"));
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        [Fact]
        public void RaAbsent_CommNetVanillaWins()
        {
            var kernel = ResolvedKernel(raPresent: false);

            var elected = CommsElection.Elected(kernel);

            Assert.NotNull(elected);
            Assert.Equal("commnet", elected!.BackendId);
        }

        [Fact]
        public void RaPresent_RealAntennasWins()
        {
            var kernel = ResolvedKernel(raPresent: true);

            var elected = CommsElection.Elected(kernel);

            Assert.NotNull(elected);
            Assert.Equal("realantennas", elected!.BackendId);
        }

        [Fact]
        public void RaAbsent_ResolutionRecordsVanillaFallbackNotice()
        {
            var kernel = new Kernel();
            CommsElection.RegisterCapability(kernel, _ => new FakeBackend("commnet"));

            var result = kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });

            Assert.Contains(result.Notices, n =>
                n.Capability == CommsElection.CapabilityId && n.Kind == "vanilla-fallback");
        }

        [Fact]
        public void ExactlyOneBackendIsElected()
        {
            var kernel = ResolvedKernel(raPresent: true);

            // Query throws unless the exclusive capability resolves to exactly
            // one active instance — the "at most one backend" invariant.
            var active = kernel.Active(CommsElection.CapabilityId);
            Assert.Single(active);
        }

        [Fact]
        public void ElectedBackend_ExposesTheSharedReadouts()
        {
            var kernel = ResolvedKernel(raPresent: false);
            var backend = CommsElection.Elected(kernel)!;

            // The minimal ICommsBackend shape both backends honour (§6): the
            // shared core comms registration reads exactly these.
            Assert.NotNull(backend.Connectivity());
            Assert.NotNull(backend.SignalStrength());
            Assert.NotNull(backend.ControlState());
            Assert.NotNull(backend.Path());
            Assert.NotNull(backend.Network());
        }
    }
}
