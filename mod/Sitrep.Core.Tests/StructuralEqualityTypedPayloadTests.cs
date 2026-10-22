using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A typed contract payload an uplink publishes as it built it must compare by
    /// value, or its channel emits one frame per capture of an unchanged state.
    /// </summary>
    public class StructuralEqualityTypedPayloadTests
    {
        private static CommsConnectivity Connected() => new CommsConnectivity
        {
            Connected = true,
            ControlSource = CommsControlSource.Full,
            HasLocalControl = true,
        };

        [Fact]
        public void TwoSeparatelyBuiltIdenticalPayloadsAreEqual()
        {
            Assert.True(StructuralEquality.Equal(Connected(), Connected()));
        }

        [Fact]
        public void APayloadWithOneDifferentPropertyIsNotEqual()
        {
            var other = Connected();
            other.Connected = false;
            Assert.False(StructuralEquality.Equal(Connected(), other));
        }

        [Fact]
        public void AnUnchangedLinkReportEmitsOnItsKeyframesAndNotOnEveryCapture()
        {
            var policy = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0));
            var emitter = new ChannelEmitter(policy, () => 1000.0 * 1000);
            var emitted = 0;
            var real = 0.0;
            var emitterWithClock = new ChannelEmitter(policy, () => real += 10.0);
            for (var ut = 0; ut < 300; ut++)
            {
                if (emitterWithClock.Decide("comms.connectivity", Connected(), ut).ShouldEmit)
                {
                    emitted++;
                }
            }
            // One keyframe per 30 UT over 300 UT, plus the first: never one per capture.
            Assert.InRange(emitted, 10, 12);
            Assert.NotNull(emitter);
        }
    }
}
