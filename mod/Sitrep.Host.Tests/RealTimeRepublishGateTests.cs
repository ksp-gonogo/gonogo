using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class RealTimeRepublishGateTests
    {
        private static int SendsInARealMinute(double sampleIntervalRealSec, bool changed)
        {
            var gate = new RealTimeRepublishGate();
            var sends = 0;
            for (var t = 0.0; t < 60.0; t += sampleIntervalRealSec)
            {
                if (gate.Admit(changed, t))
                {
                    sends++;
                }
            }
            return sends;
        }

        [Fact]
        public void A_warped_minute_sends_no_more_often_than_an_unwarped_one()
        {
            // 1x samples about once per real second; 1000x about ten times per real second.
            var unwarped = SendsInARealMinute(1.0, changed: true);
            var warped = SendsInARealMinute(0.1, changed: true);
            Assert.True(warped <= unwarped, $"warped {warped} sends vs unwarped {unwarped}");
        }

        [Fact]
        public void Unchanged_content_goes_out_once_per_keyframe_period_however_fast_the_sampler_runs()
        {
            Assert.Equal(2, SendsInARealMinute(0.1, changed: false));
        }

        [Fact]
        public void A_change_waits_for_the_floor_and_is_sent_when_it_passes()
        {
            var gate = new RealTimeRepublishGate();
            Assert.True(gate.Admit(true, 0.0));
            Assert.False(gate.Admit(true, 0.5));
            Assert.True(gate.Admit(true, 1.0));
        }

        [Fact]
        public void A_clock_that_went_backwards_does_not_hold_the_topic_silent()
        {
            var gate = new RealTimeRepublishGate();
            Assert.True(gate.Admit(false, 100.0));
            Assert.True(gate.Admit(true, 5.0));
        }
    }
}
