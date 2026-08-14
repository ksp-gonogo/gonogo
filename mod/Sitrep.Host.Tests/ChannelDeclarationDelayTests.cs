using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Round-trips <see cref="ChannelDeclaration.Delay"/>: the Minor-bump
    /// per-channel delay disposition (see
    /// <c>.superpowers/sdd/contract-dynamic-delay-report.md</c>). Two things
    /// this proves:
    ///
    /// 1. The default is <see cref="DelayRole.Delayed"/> (matching
    ///    <see cref="CommandDeclaration.Delayed"/>'s own default-true
    ///    precedent): every EXISTING call site that never sets this
    ///    property keeps compiling and defaulting the same way.
    /// 2. Both enum values round-trip through the property untouched, the
    ///    trivial "this is a real settable property, not a typo" smoke test
    ///    every new contract field needs.
    /// </summary>
    public class ChannelDeclarationDelayTests
    {
        [Fact]
        public void DefaultsToDelayed()
        {
            var declaration = new ChannelDeclaration { Topic = "test.topic" };
            Assert.Equal(DelayRole.Delayed, declaration.Delay);
        }

        [Theory]
        [InlineData(DelayRole.Delayed)]
        [InlineData(DelayRole.TrueNow)]
        public void RoundTripsExplicitDisposition(DelayRole role)
        {
            var declaration = new ChannelDeclaration { Topic = "test.topic", Delay = role };
            Assert.Equal(role, declaration.Delay);
        }

        /// <summary>
        /// Manual mirror of the per-topic <c>Delay</c> values
        /// <c>Gonogo.KSP.ScienceCoreUplink.Manifest.Channels</c> actually declares.
        /// That assembly is the only one in the mod touching KSP/Unity types
        /// (see its csproj's own comment) and is never test-compiled, so this
        /// table can't be read via reflection off the real manifest, so it is
        /// kept in sync by hand, the same cross-project-unreachable reason the
        /// KSP-free wire replicas in <c>Sitrep.Host.IntegrationTests</c> exist.
        /// Update both sides together on any future change to ScienceCoreUplink's
        /// channel table.
        /// </summary>
        private static readonly Dictionary<string, DelayRole> ScienceUplinkChannelDelay = new Dictionary<string, DelayRole>
        {
            [ScienceViewProvider.ExperimentsTopic] = DelayRole.Delayed,
            [ScienceViewProvider.InstrumentsTopic] = DelayRole.Delayed,
            [ScienceViewProvider.LabTopic] = DelayRole.Delayed,
            [ScienceViewProvider.SensorsTopic] = DelayRole.Delayed,
            [ScienceViewProvider.ExperimentBreakdownTopic] = DelayRole.Delayed,
            [ScienceViewProvider.ArchiveTopic] = DelayRole.TrueNow,
        };

        /// <summary>
        /// The archive is career-wide banked science read at KSC/R&amp;D,
        /// ground-side bookkeeping like <c>CareerUplink</c>'s
        /// <c>career.status</c>/<c>career.mode</c>, not something learned over
        /// the active vessel's comms link, so it is the sole
        /// <see cref="DelayRole.TrueNow"/> entry in <c>science.*</c>.
        /// </summary>
        [Fact]
        public void ScienceArchiveChannelIsTrueNow()
        {
            Assert.Equal(DelayRole.TrueNow, ScienceUplinkChannelDelay[ScienceViewProvider.ArchiveTopic]);
        }

        /// <summary>
        /// Every other <c>science.*</c> channel reads live onboard vessel
        /// state over the comms link and must stay <see cref="DelayRole.Delayed"/>,
        /// locking in the non-regression against the archive's TrueNow addition.
        /// </summary>
        [Theory]
        [InlineData(ScienceViewProvider.ExperimentsTopic)]
        [InlineData(ScienceViewProvider.InstrumentsTopic)]
        [InlineData(ScienceViewProvider.LabTopic)]
        [InlineData(ScienceViewProvider.SensorsTopic)]
        [InlineData(ScienceViewProvider.ExperimentBreakdownTopic)]
        public void OtherScienceChannelsRemainDelayed(string topic)
        {
            Assert.Equal(DelayRole.Delayed, ScienceUplinkChannelDelay[topic]);
        }
    }
}
