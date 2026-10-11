using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// An addressed sample can only be published by one of Gonogo's own sources,
    /// which says so by declaring the topic while its Uplink registers. A
    /// channel declared <see cref="ChannelDeclaration.Addressed"/> that nothing
    /// publishes for would stay silent, so its Uplink is refused instead.
    /// </summary>
    public class AddressedChannelRefusalTests
    {
        private const string Topic = "addressed.test";

        [Fact]
        public void AnUplinkDeclaringAnAddressedChannelNoCoreSourcePublishesIsRefused()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new AddressedUplink(declareTopic: false);

            engine.RegisterUplink(uplink);

            var availability = engine.AvailabilityOf(uplink.Manifest.Id);
            Assert.False(availability.IsAvailable);
            Assert.Contains(Topic, availability.Reason!);
        }

        [Fact]
        public void AnUplinkWhoseSourceDeclaresTheAddressedTopicIsAccepted()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new AddressedUplink(declareTopic: true);

            engine.RegisterUplink(uplink);

            Assert.True(engine.AvailabilityOf(uplink.Manifest.Id).IsAvailable);
        }

        private sealed class AddressedUplink : ISitrepUplink
        {
            private readonly bool _declareTopic;

            public AddressedUplink(bool declareTopic)
            {
                _declareTopic = declareTopic;
                Manifest = new UplinkManifest
                {
                    Id = declareTopic ? "addressed-declared-test" : "addressed-undeclared-test",
                    Version = "1.0.0",
                    Channels = new List<ChannelDeclaration>
                    {
                        new ChannelDeclaration
                        {
                            Topic = Topic,
                            Delivery = Delivery.LossyLatest,
                            Emission = new EmissionPolicy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(0)),
                            Delay = DelayRole.Delayed,
                            Addressed = true,
                        },
                    },
                };
            }

            public UplinkManifest Manifest { get; }

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                if (_declareTopic)
                {
                    ((Commcast.IAddressedStreamHost)host).DeclareAddressedTopic(Topic);
                }
            }
        }
    }
}
