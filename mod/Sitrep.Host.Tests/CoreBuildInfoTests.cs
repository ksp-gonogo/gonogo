using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class CoreBuildInfoTests
    {
        [Fact]
        public void ReadsTheVersionLineOfAReleaseBuildInfoFile()
        {
            var text = "version=v1.4.0\ngit_sha=0123abc\nbuild_date=2026-10-11T00:00:00Z\n";
            Assert.Equal("v1.4.0", CoreBuildInfo.ParseVersion(text));
        }

        [Fact]
        public void ReadsACandidateLabelAndToleratesWindowsLineEndings()
        {
            Assert.Equal("rc-abc1234", CoreBuildInfo.ParseVersion("git_sha=x\r\nversion=rc-abc1234\r\n"));
        }

        [Fact]
        public void IsNullWhenTheFileNamesNoVersion()
        {
            Assert.Null(CoreBuildInfo.ParseVersion("git_sha=x\n"));
            Assert.Null(CoreBuildInfo.ParseVersion("version=\n"));
        }

        [Fact]
        public void IsNullForABuildThatShipsNoBuildInfoFile()
        {
            Assert.Null(CoreBuildInfo.Version);
        }
    }
}
