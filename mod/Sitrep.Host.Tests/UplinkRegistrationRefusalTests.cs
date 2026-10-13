using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// An Uplink never takes over what another Uplink, or core, already owns, and an
    /// Uplink whose manifest cannot be trusted is refused rather than registered. In
    /// each case the refusal says why, on the Uplink's own entry.
    /// </summary>
    public class UplinkRegistrationRefusalTests
    {
        private static ChannelDeclaration Channel(string topic) => new ChannelDeclaration
        {
            Kind = SampleKind.Discrete,
            Requires = Requirement.None,
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Delay = DelayRole.TrueNow,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        private sealed class TestUplink : ISitrepUplink
        {
            private readonly Func<UplinkManifest> _manifest;
            private readonly Action<IUplinkHost>? _register;

            public TestUplink(UplinkManifest manifest, Action<IUplinkHost>? register = null)
                : this(() => manifest, register)
            {
            }

            public TestUplink(Func<UplinkManifest> manifest, Action<IUplinkHost>? register = null)
            {
                _manifest = manifest;
                _register = register;
            }

            public bool Registered { get; private set; }

            public UplinkManifest Manifest => _manifest();

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
                Registered = true;
                _register?.Invoke(host);
            }
        }

        private static UplinkManifest Manifest(string id, string? topic = null, string? command = null) => new UplinkManifest
        {
            Id = id,
            Version = "1.0.0",
            Channels = topic == null ? new List<ChannelDeclaration>() : new List<ChannelDeclaration> { Channel(topic) },
            Commands = command == null
                ? new List<CommandDeclaration>()
                : new List<CommandDeclaration> { new CommandDeclaration { Command = command, Delay = DelayRole.TrueNow } },
        };

        private static UplinkDiscovery.DiscoveredUplink Discovered(ISitrepUplink uplink, string id) =>
            new UplinkDiscovery.DiscoveredUplink(uplink, ContractVersion.Major, ContractVersion.Minor, id);

        [Fact]
        public void A_topic_another_uplink_owns_is_refused_and_the_owner_keeps_it()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var owner = new TestUplink(Manifest("owner", topic: "shared.topic"));
            var thief = new TestUplink(Manifest("thief", topic: "shared.topic"));

            engine.RegisterUplink(owner);
            engine.RegisterUplink(thief);

            Assert.True(engine.AvailabilityOf("owner").IsAvailable);
            var refused = engine.AvailabilityOf("thief");
            Assert.False(refused.IsAvailable);
            Assert.Contains("channel \"shared.topic\" already belongs to \"owner\"", refused.Reason);
            Assert.False(thief.Registered);
        }

        [Fact]
        public void A_topic_the_engine_declares_itself_is_refused_to_an_uplink()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var thief = new TestUplink(Manifest("thief", topic: "system.uplinks"));

            engine.RegisterUplink(thief);

            var refused = engine.AvailabilityOf("thief");
            Assert.False(refused.IsAvailable);
            Assert.Contains("channel \"system.uplinks\" belongs to the engine itself", refused.Reason);
            Assert.False(thief.Registered);
        }

        [Fact]
        public void A_discovered_uplink_cannot_take_a_topic_from_one_core_registered_first()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new TestUplink(Manifest("core-one", topic: "comms.contacts")));
            var third = new TestUplink(Manifest("third-party", topic: "comms.contacts"));

            engine.RegisterDiscoveredUplinks(new[] { Discovered(third, "third-party") });

            Assert.True(engine.AvailabilityOf("core-one").IsAvailable);
            Assert.Contains("already belongs to \"core-one\"", engine.AvailabilityOf("third-party").Reason);
            Assert.False(third.Registered);
        }

        [Fact]
        public void A_discovered_uplink_reusing_a_core_id_leaves_the_core_uplink_running()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var core = new TestUplink(Manifest("core-one", topic: "core.topic"));
            engine.RegisterUplink(core);
            var third = new TestUplink(Manifest("core-one", topic: "third.topic"));

            engine.RegisterDiscoveredUplinks(new[] { Discovered(third, "core-one") });

            Assert.True(engine.AvailabilityOf("core-one").IsAvailable);
            Assert.False(third.Registered);
        }

        [Fact]
        public void A_command_another_uplink_owns_is_refused()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new TestUplink(Manifest("owner", command: "shared.command")));
            var thief = new TestUplink(Manifest("thief", command: "shared.command"));

            engine.RegisterUplink(thief);

            Assert.Contains("command \"shared.command\" already belongs to \"owner\"", engine.AvailabilityOf("thief").Reason);
            Assert.False(thief.Registered);
        }

        [Fact]
        public void An_uplink_cannot_source_a_channel_it_does_not_declare()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.RegisterUplink(new TestUplink(Manifest("owner", topic: "owned.topic")));
            var thief = new TestUplink(
                Manifest("thief", topic: "thief.topic"),
                host => host.AddChannelSource("owned.topic", _ => 1.0));

            engine.RegisterUplink(thief);

            Assert.True(engine.AvailabilityOf("owner").IsAvailable);
            Assert.False(engine.AvailabilityOf("thief").IsAvailable);
            Assert.Contains("\"owner\" owns", engine.AvailabilityOf("thief").Reason);
        }

        [Fact]
        public void Two_installed_copies_of_one_id_are_both_refused()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var first = new TestUplink(Manifest("twin", topic: "twin.topic"));
            var second = new TestUplink(Manifest("twin", topic: "twin.topic"));

            engine.RegisterDiscoveredUplinks(new[] { Discovered(first, "twin"), Discovered(second, "twin") });

            var availability = engine.AvailabilityOf("twin");
            Assert.False(availability.IsAvailable);
            Assert.Contains("2 installed Uplinks claim the id \"twin\"", availability.Reason);
            Assert.False(first.Registered);
            Assert.False(second.Registered);
        }

        [Fact]
        public void A_manifest_id_that_differs_from_the_attribute_is_refused()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new TestUplink(Manifest("manifest-name"));

            engine.RegisterDiscoveredUplinks(new[] { Discovered(uplink, "attribute-name") });

            var availability = engine.AvailabilityOf("attribute-name");
            Assert.False(availability.IsAvailable);
            Assert.Contains("differs from its [SitrepUplink] id", availability.Reason);
            Assert.False(uplink.Registered);
        }

        [Fact]
        public void A_manifest_that_throws_is_refused_without_stopping_the_others()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var broken = new TestUplink(() => throw new InvalidOperationException("no manifest"));
            var healthy = new TestUplink(Manifest("healthy", topic: "healthy.topic"));

            engine.RegisterDiscoveredUplinks(new[] { Discovered(broken, "broken"), Discovered(healthy, "healthy") });

            Assert.Contains("its manifest threw when read", engine.AvailabilityOf("broken").Reason);
            Assert.True(engine.AvailabilityOf("healthy").IsAvailable);
            Assert.True(healthy.Registered);
        }
    }
}
