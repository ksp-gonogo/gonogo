using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Xunit;
using Xunit.Sdk;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The engine's publisher for a channel that follows the active craft passes
    /// the shipped <see cref="CraftReadingPublisherConformance"/> assertion, and
    /// the assertion fails a publisher that throws.
    /// </summary>
    public class CraftReadingPublisherConformanceTests
    {
        private const string Topic = "lane-conformance-test.supplies";

        [Fact]
        public void TheEnginesPublisherForAFollowingChannelConforms()
        {
            var uplink = new FollowingUplink();
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(uplink);
            engine.Start();
            try
            {
                var publisher = Assert.IsAssignableFrom<ICraftReadingPublisher>(uplink.Publisher);
                Assert.True(engine.FollowsActiveCraft(Topic));

                CraftReadingPublisherConformance.AssertAcceptsEveryCraftsReading(publisher, 42.0);
            }
            finally
            {
                engine.Stop();
                engine.Dispose();
            }
        }

        [Fact]
        public void APublisherThatThrowsForACraftItHasNotSeenDoesNot()
        {
            Assert.ThrowsAny<XunitException>(
                () => CraftReadingPublisherConformance.AssertAcceptsEveryCraftsReading(new Throwing(), 42.0));
        }

        private sealed class Throwing : ICraftReadingPublisher
        {
            public void PublishFor(string vesselId, object? payload, double ut) =>
                throw new KeyNotFoundException("no record for " + vesselId);
        }

        private sealed class FollowingUplink : ISitrepUplink
        {
            public IChannelPublisher? Publisher { get; private set; }

            public UplinkManifest Manifest { get; } = new UplinkManifest
            {
                Id = "lane-conformance-test",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    new ChannelDeclaration
                    {
                        Kind = SampleKind.Continuous,
                        Topic = Topic,
                        Delivery = Delivery.LossyLatest,
                        Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                        Delay = DelayRole.Delayed,
                        FollowsActiveCraft = true,
                    },
                },
            };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host) => Publisher = host.Publisher(Topic);
        }
    }
}
