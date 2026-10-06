using Gonogo.KSP;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// An expansion-gated Uplink's health follows the install as it stands when asked, because KSP
    /// lists its installed expansions only after the Uplink has registered.
    /// </summary>
    public class ExpansionHealthTests
    {
        [Fact]
        public void ReportsHealthyOnceTheExpansionAppearsAfterAnEarlierAbsentRead()
        {
            var installed = false;
            var health = new ExpansionHealth(() => installed, "Making History is not installed");

            Assert.Equal(UplinkHealthState.Unavailable, health.Report().State);

            installed = true;

            Assert.Equal(UplinkHealthState.Healthy, health.Report().State);
        }

        [Fact]
        public void NamesTheAbsentExpansionWhileItIsMissing()
        {
            var health = new ExpansionHealth(() => false, "Making History is not installed");

            Assert.Equal("Making History is not installed", health.Report().Detail);
        }

        [Fact]
        public void StopsReadingTheInstallOnceItHasReadInstalled()
        {
            var reads = 0;
            var health = new ExpansionHealth(() => { reads++; return true; }, "Making History is not installed");

            health.Report();
            health.Report();
            health.Report();

            Assert.Equal(1, reads);
        }

        [Fact]
        public void KeepsReadingTheInstallWhileItReadsAbsent()
        {
            var reads = 0;
            var health = new ExpansionHealth(() => { reads++; return false; }, "Making History is not installed");

            health.Report();
            health.Report();

            Assert.Equal(2, reads);
        }
    }
}
