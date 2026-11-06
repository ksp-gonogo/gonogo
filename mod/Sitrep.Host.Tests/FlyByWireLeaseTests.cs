using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class FlyByWireLeaseTests
    {
        [Fact]
        public void ALeaseThatWasNeverStartedNeverLapses()
        {
            var lease = new FlyByWireLease();

            Assert.False(lease.Held);
            Assert.False(lease.HasLapsed(1_000_000));
        }

        [Fact]
        public void ALeaseLapsesOnceItsLengthPassesWithNoRenewal()
        {
            var lease = new FlyByWireLease();
            lease.Renew(100);

            Assert.False(lease.HasLapsed(100 + FlyByWireLease.LeaseSeconds - 0.1));
            Assert.True(lease.HasLapsed(100 + FlyByWireLease.LeaseSeconds));
        }

        [Fact]
        public void ARenewalExtendsTheLeaseFromTheRenewal()
        {
            var lease = new FlyByWireLease();
            lease.Renew(100);
            lease.Renew(104);

            Assert.False(lease.HasLapsed(108));
            Assert.True(lease.HasLapsed(109));
        }

        [Fact]
        public void AReleasedLeaseNeverLapses()
        {
            var lease = new FlyByWireLease();
            lease.Renew(100);
            lease.Release();

            Assert.False(lease.Held);
            Assert.False(lease.HasLapsed(1_000));
        }

        [Fact]
        public void TheRenewalCommandStaysOffThePendingList()
        {
            Assert.True(InternalCommands.Contains(VesselCommandProvider.HoldFlyByWireCommand));
            Assert.False(InternalCommands.Contains(VesselCommandProvider.SetFlyByWireCommand));
        }

        [Fact]
        public void TheHandlerRenewsThroughTheActuator()
        {
            var actuator = new FakeVesselActuator();

            VesselCommandProvider.HandleHoldFlyByWire(actuator, null);

            Assert.Equal(1, actuator.HoldFlyByWireCallCount);
        }
    }
}
