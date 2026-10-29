using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Xunit;
using Xunit.Sdk;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The shipped <see cref="TimelineListenerConformance"/> assertion passes a
    /// listener that survives every reset and fails one that throws.
    /// </summary>
    public class TimelineListenerConformanceTests
    {
        [Fact]
        public void AListenerThatForgetsOnEveryResetConforms()
        {
            var listener = new Forgetting();

            TimelineListenerConformance.AssertSurvivesResets(listener);

            Assert.Equal(new[] { false, true, false, true }, listener.Resets);
        }

        [Fact]
        public void AListenerThatThrowsOnAResetDoesNot()
        {
            Assert.ThrowsAny<XunitException>(() => TimelineListenerConformance.AssertSurvivesResets(new Throwing()));
        }

        private sealed class Forgetting : IUplinkTimelineListener
        {
            public List<bool> Resets { get; } = new List<bool>();

            public void OnTimelineReset(bool saveChanged) => Resets.Add(saveChanged);
        }

        private sealed class Throwing : IUplinkTimelineListener
        {
            public void OnTimelineReset(bool saveChanged) => throw new InvalidOperationException("nothing to clear");
        }
    }
}
