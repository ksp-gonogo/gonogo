using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// <see cref="IUplinkHost.SetAvailability"/> names the uplink whose
    /// <see cref="ISitrepUplink.Register"/> is on the stack, so a call from
    /// anywhere else has no uplink to write to.
    ///
    /// <para>It used to drop that call without a word, which is the worst shape
    /// the loss could take: an uplink that reported "the mod I integrate is
    /// missing" from a later callback went on reading Available on
    /// <c>system.uplinks</c>, indistinguishable from one that was working. The
    /// write is still dropped, deliberately, and now it says so, the same rule
    /// <c>MarkUplinkUnavailable</c> already holds.</para>
    /// </summary>
    public class SetAvailabilityScopeTests
    {
        [Fact]
        public void ACallDuringRegisterMarksTheRegisteringUplink()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new LateAvailabilityUplink());
            engine.Start();
            try
            {
                var availability = engine.AvailabilityOf(LateAvailabilityUplink.Id);
                Assert.False(availability.IsAvailable);
                Assert.Equal(LateAvailabilityUplink.RegisterReason, availability.Reason);
            }
            finally
            {
                engine.Stop();
            }
        }

        [Fact]
        public void ACallAfterRegisterIsIgnoredAndSaysSo()
        {
            var diagnostics = new ConcurrentQueue<string>();
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.SetDiagnosticLog(diagnostics.Enqueue);

            var uplink = new LateAvailabilityUplink();
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                diagnostics.Clear();
                uplink.ReportLate("Example Mod went away");

                // The verdict from registration still stands: nothing silently
                // overwrote it, and nothing silently took effect either.
                Assert.Equal(
                    LateAvailabilityUplink.RegisterReason,
                    engine.AvailabilityOf(LateAvailabilityUplink.Id).Reason);

                var lines = diagnostics.ToArray();
                Assert.Contains(lines, line => line.Contains("SetAvailability") && line.Contains("IGNORED"));
                // It has to point somewhere: Health is where a later state change goes.
                Assert.Contains(lines, line => line.Contains("Health"));
            }
            finally
            {
                engine.Stop();
            }
        }

        private sealed class LateAvailabilityUplink : ISitrepUplink
        {
            public const string Id = "late-availability";
            public const string RegisterReason = "Example Mod is not installed";

            private IUplinkHost? _host;

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = Id,
                Version = "0.1.0",
                Channels = new List<ChannelDeclaration>(),
            };

            public void Register(IUplinkHost host)
            {
                _host = host;
                host.SetAvailability(Availability.Unavailable(RegisterReason));
            }

            public void ReportLate(string reason) =>
                _host?.SetAvailability(Availability.Unavailable(reason));

            public UplinkHealth Health() => UplinkHealth.Unavailable(RegisterReason);
        }
    }
}
