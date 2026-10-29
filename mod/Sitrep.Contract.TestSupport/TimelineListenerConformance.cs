using System;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="IUplinkTimelineListener"/> promises, for an Uplink author to
    /// run against their own implementation.
    /// </summary>
    public static class TimelineListenerConformance
    {
        /// <summary>
        /// Delivers a reset within the same save, a reset to another save, and the
        /// same two again, as the host does across a quickload followed by a load.
        ///
        /// <para>Fails when any delivery throws: the host reports a throw and carries
        /// on, which leaves the Uplink holding the cache the reset was meant to
        /// clear. A repeated reset must also leave the listener usable, so a
        /// reset that arrives before anything was published is not an error.</para>
        /// </summary>
        /// <param name="listener">The Uplink under test, freshly built and holding nothing published yet.</param>
        public static void AssertSurvivesResets(IUplinkTimelineListener listener)
        {
            Assert.NotNull(listener);
            var name = listener.GetType().Name;

            foreach (var saveChanged in new[] { false, true, false, true })
            {
                Exception? thrown = null;
                try
                {
                    listener.OnTimelineReset(saveChanged);
                }
                catch (Exception ex)
                {
                    thrown = ex;
                }
                Assert.True(
                    thrown == null,
                    name + ".OnTimelineReset(saveChanged: " + saveChanged + ") threw " + (thrown?.GetType().Name ?? "") + ": "
                    + (thrown?.Message ?? "") + ". The host only logs a throw, so the cache this call exists to clear stays.");
            }
        }
    }
}
