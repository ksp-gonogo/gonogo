using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// <see cref="CommsHealth"/> — the comms core uplink's
    /// <see cref="ISitrepUplink.Health"/> state machine (mirrors
    /// <c>GonogoKerbcastUplink.Tests.KerbcastHealthTests</c>).
    /// </summary>
    public class CommsHealthTests
    {
        [Fact]
        public void ReportsDegraded_BeforeABackendIsElected()
        {
            var health = CommsHealth.Evaluate(backendElected: false);

            // Not Unavailable: the core uplink always registers the vanilla
            // CommNet backend as the capability's fallback, so a null result
            // here means "resolution hasn't run yet", not "comms is broken".
            Assert.Equal(UplinkHealthState.Degraded, health.State);
            Assert.Equal("no comms backend elected", health.Detail);
        }

        [Fact]
        public void ReportsHealthy_OnceABackendIsElected()
        {
            var health = CommsHealth.Evaluate(backendElected: true);

            Assert.Equal(UplinkHealthState.Healthy, health.State);
        }
    }
}
