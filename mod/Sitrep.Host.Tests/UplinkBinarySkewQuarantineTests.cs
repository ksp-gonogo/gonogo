using System;
using System.Reflection;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// An Uplink built against an older contract can pass the version gate and
    /// then fail on its first call into a changed member. That failure names the
    /// Uplink and the contract it was built against, and leaves the Uplink
    /// unavailable rather than reading as an ordinary failed read.
    /// </summary>
    public class UplinkBinarySkewQuarantineTests
    {
        [Theory]
        [InlineData(typeof(MissingMethodException))]
        [InlineData(typeof(MissingFieldException))]
        [InlineData(typeof(TypeLoadException))]
        public void ASkewFailureQuarantinesTheUplinkOwningTheProvider(Type kind)
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new SkewTestUplink();
            engine.RegisterUplink(uplink);

            var error = (Exception)Activator.CreateInstance(kind, "void Sitrep.Contract.CommsRouteHop..ctor(double)")!;
            var quarantined = engine.QuarantineProviderOwner(uplink, error);

            Assert.True(quarantined);
            var availability = engine.AvailabilityOf(SkewTestUplink.Id);
            Assert.False(availability.IsAvailable);
            Assert.Contains(SkewTestUplink.Id, availability.Reason!);
            Assert.Contains($"v{ContractVersion.Major}.{ContractVersion.Minor}", availability.Reason!);
            Assert.Contains("CommsRouteHop", availability.Reason!);
        }

        [Fact]
        public void ASkewFailureInsideAnInvocationWrapperIsStillSkew()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new SkewTestUplink();
            engine.RegisterUplink(uplink);

            var wrapped = new TargetInvocationException(new MissingMethodException("void X..ctor()"));

            Assert.True(engine.QuarantineProviderOwner(uplink, wrapped));
            Assert.False(engine.AvailabilityOf(SkewTestUplink.Id).IsAvailable);
        }

        [Fact]
        public void AnOrdinaryFailureLeavesTheUplinkAvailable()
        {
            var engine = new ChannelEngine("ws://127.0.0.1:0");
            var uplink = new SkewTestUplink();
            engine.RegisterUplink(uplink);

            var quarantined = engine.QuarantineProviderOwner(uplink, new InvalidOperationException("torn down"));

            Assert.False(quarantined);
            Assert.True(engine.AvailabilityOf(SkewTestUplink.Id).IsAvailable);
        }

        private sealed class SkewTestUplink : ISitrepUplink
        {
            public const string Id = "skew-test";

            public UplinkManifest Manifest { get; } = new UplinkManifest { Id = Id, Version = "1.0.0" };

            public UplinkHealth Health() => UplinkHealth.Healthy;

            public void Register(IUplinkHost host)
            {
            }
        }
    }
}
