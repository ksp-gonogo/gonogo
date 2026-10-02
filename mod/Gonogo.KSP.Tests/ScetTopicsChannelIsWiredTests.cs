using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// That the addressable-Topic table is published from the same
    /// <c>ScetThresholdSources</c> the arm refuses against, and answered the way
    /// the roster is.
    ///
    /// <para>Source text, for the reason <c>ScetShadowAudienceIsWiredTests</c>
    /// gives: <c>ScetAlarmUplink</c> needs a live scene, so the wiring cannot be
    /// exercised from here.</para>
    /// </summary>
    public class ScetTopicsChannelIsWiredTests
    {
        [Fact]
        public void the_channel_is_declared_and_published_from_the_table_the_arm_checks()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");

            Assert.Contains("Topic = TopicsTopic", uplink, StringComparison.Ordinal);
            Assert.Contains("host.Publisher(TopicsTopic)", uplink, StringComparison.Ordinal);

            var publish = CurrencyDelaySourceText.MethodBody(
                uplink, "private void PublishTopicsIfDue(ScetAlarmPublish publish)");
            Assert.Contains("_thresholds.Topics", publish, StringComparison.Ordinal);

            var arm = CurrencyDelaySourceText.MethodBody(
                uplink, "private CommandResult HandleArm(ScetAlarmArmArgs? args, string vantage)");
            Assert.Contains("_thresholds.Knows(condition.Topic)", arm, StringComparison.Ordinal);
        }

        [Fact]
        public void a_subscriber_is_answered_through_the_audience_check_and_not_a_one_off_publish()
        {
            var uplink = CurrencyDelaySourceText.ReadRelative("ScetAlarmUplink.cs");

            var publish = CurrencyDelaySourceText.MethodBody(
                uplink, "private void PublishTopicsIfDue(ScetAlarmPublish publish)");
            Assert.Contains(
                "_topicsAudience.ShouldPublish(publish.HasTopicsAudience", publish, StringComparison.Ordinal);

            var capture = CurrencyDelaySourceText.MethodBody(
                uplink, "private object? CaptureOnMain(KspSnapshot? snapshot)");
            Assert.Contains("IsAnyTopicSubscribed(TopicsTopic)", capture, StringComparison.Ordinal);
        }
    }
}
