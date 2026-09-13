using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// <see cref="ChannelEngine.ResolveCapabilities"/> says out loud when a capability
    /// is left unresolved, and still keeps a graph-wide kernel failure from taking the
    /// engine down.
    ///
    /// <para>An unresolved capability reads on the wire exactly like one nobody
    /// claimed, so the only place an operator can learn that two claimants tied is the
    /// diagnostic log. Before per-capability isolation this path caught the ambiguity
    /// and wrote one line to <c>Console.Error</c> while every capability went dark
    /// together.</para>
    ///
    /// <para>Each test starts the engine after resolving, the production order, only
    /// because disposing an engine that never started throws.</para>
    /// </summary>
    public class CapabilityResolutionReportingTests
    {
        private static readonly IReadOnlyList<HomeNodeFacts> Homes = new[]
        {
            new HomeNodeFacts(true, "Kerbal Space Center"),
        };

        private sealed class Claimant : IHomeCommandProvider
        {
            public Claimant(string id) => ProviderId = id;

            public string ProviderId { get; }

            public HomeCommand Identify() => HomeCommand.Identified("ground:" + ProviderId);
        }

        private static void Claim(Kernel kernel, string id, double priority)
        {
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = HomeCommandCapability.Id,
                Id = id,
                Priority = priority,
                Factory = _ => new Claimant(id),
            });
        }

        private static string[] CapabilityLines(ConcurrentQueue<string> diagnostics) =>
            diagnostics.Where(l => l.Contains("capability")).ToArray();

        [Fact]
        public void TiedHomeCommandClaimants_AreLogged_AndAnUnrelatedCapabilityStillResolves()
        {
            var diagnostics = new ConcurrentQueue<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.SetDiagnosticLog(diagnostics.Enqueue);

            HomeCommandElection.RegisterCapability(engine.Kernel, () => Homes);
            Claim(engine.Kernel, "comms-claimant", 10.0);
            Claim(engine.Kernel, "overhaul-claimant", 10.0);
            engine.Kernel.RegisterCapability(new CapabilityDescriptor { Id = "unrelated", Exclusive = true });
            engine.Kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "unrelated",
                Id = "unrelated-provider",
                Factory = _ => "served",
            });

            var result = engine.ResolveCapabilities();
            engine.Start();
            try
            {
                Assert.Null(HomeCommandElection.Elected(engine.Kernel));
                Assert.Equal("served", engine.Kernel.Query<string>("unrelated"));
                Assert.Equal(
                    new[] { "comms-claimant", "overhaul-claimant" },
                    result.Notices
                        .Where(n => n.Capability == HomeCommandCapability.Id && n.Kind == "ambiguous")
                        .Select(n => n.ProviderId)
                        .ToArray());

                var line = Assert.Single(CapabilityLines(diagnostics));
                Assert.Contains("AMBIGUOUS", line);
                Assert.Contains("\"" + HomeCommandCapability.Id + "\"", line);
                Assert.Contains("comms-claimant", line);
                Assert.Contains("overhaul-claimant", line);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void WithNoTie_NoCapabilityIsLogged()
        {
            var diagnostics = new ConcurrentQueue<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.SetDiagnosticLog(diagnostics.Enqueue);

            HomeCommandElection.RegisterCapability(engine.Kernel, () => Homes);
            Claim(engine.Kernel, "comms-claimant", 10.0);
            Claim(engine.Kernel, "overhaul-claimant", 20.0);

            engine.ResolveCapabilities();
            engine.Start();
            try
            {
                Assert.Equal("overhaul-claimant", HomeCommandElection.Elected(engine.Kernel)!.ProviderId);
                Assert.Empty(CapabilityLines(diagnostics));
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// A dependency cycle is still thrown out of the kernel, because a cycle has no
        /// one capability to isolate it to. The engine's catch is what keeps that from
        /// aborting startup, and it must say so through the diagnostic sink rather
        /// than only to a console nobody on the Deck reads.
        /// </summary>
        [Fact]
        public void ADependencyCycle_DoesNotThrow_AndIsLogged()
        {
            var diagnostics = new ConcurrentQueue<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.SetDiagnosticLog(diagnostics.Enqueue);

            foreach (var (id, dep) in new[] { ("x", "y"), ("y", "x") })
            {
                engine.Kernel.RegisterCapability(new CapabilityDescriptor { Id = id, Exclusive = true });
                engine.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = id,
                    Id = id + "-provider",
                    Deps = new[] { dep },
                    Factory = _ => id,
                });
            }

            var result = engine.ResolveCapabilities();
            engine.Start();
            try
            {
                Assert.Empty(result.Notices);
                Assert.Empty(engine.Kernel.Active("x"));
                var line = Assert.Single(CapabilityLines(diagnostics));
                Assert.Contains("capability resolution threw", line);
                Assert.Contains("EVERY capability is unresolved", line);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}
