using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// <see cref="IKspHost.NowUt"/> throws when there is no universal time to
    /// read, and <see cref="Recorder"/>'s constructor is the single place in
    /// the tree that does not let that refusal through: it runs during the
    /// addon's <c>Awake</c>, before a save is loaded, so a throw there would
    /// abort mod startup over the ordinary case.
    ///
    /// <para>What makes that exemption safe is that the substituted 0 reaches
    /// nothing which reads a timeline, and the way to hold it safe is to pin
    /// the recorder's arithmetic on the host's clock at exactly one call. A
    /// host that refuses on every call makes any second one fail here.</para>
    /// </summary>
    public class RecorderClocklessHostTests
    {
        [Fact]
        public void RecorderConstructsAgainstAHostThatHasNoClockYet()
        {
            var host = new ClocklessHost();

            var recorder = new Recorder(host);

            Assert.Equal(0.0, recorder.Session.StartUt);
            Assert.Equal(1, host.Refusals);
        }

        [Fact]
        public void EveryEntryIsStampedFromItsOwnArgumentAndNeverFromTheHostClock()
        {
            var host = new ClocklessHost();
            var recorder = new Recorder(host);

            recorder.Record(1234.5, new KspSnapshot
            {
                Ut = 1234.5,
                Values = new Dictionary<string, object?> { ["time"] = 1234.5 },
            });
            host.FireLifecycle(new KspLifecycleEvent
            {
                Ut = 2345.5,
                Kind = "flight-ready",
                Args = new Dictionary<string, object?>(),
            });

            Assert.Collection(
                recorder.Session.Entries,
                entry => Assert.Equal(1234.5, entry.T),
                entry => Assert.Equal(2345.5, entry.T));

            // The construction-time read is the only one. A second would have
            // thrown out of Record or the lifecycle handler above.
            Assert.Equal(1, host.Refusals);
        }

        /// <summary>
        /// A host in the state a live one is in before any save is loaded:
        /// <see cref="Sample"/> still answers, and there is no UT.
        /// </summary>
        private sealed class ClocklessHost : IKspHost
        {
            public int Refusals { get; private set; }

            public void FireLifecycle(KspLifecycleEvent evt) => Lifecycle.Invoke(evt);

            public double NowUt()
            {
                Refusals++;
                throw new InvalidOperationException("no universal time before a save is loaded");
            }

            public KspSnapshot Sample() => new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>(),
            };

            public event Action<KspLifecycleEvent> Lifecycle = delegate { };
        }
    }
}
