using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A career group handed on from an earlier sample is reported to the engine, which
    /// then builds none of its declared readers from that tick and hands anything owned
    /// outside the core a snapshot without it, so nothing published from it is stamped
    /// with a later UT than it was read at. With no engine wired, nothing is kept.
    ///
    /// <para>Source text, not behaviour: the sample reads live KSP and cannot be compiled
    /// into this project.</para>
    /// </summary>
    public class KeptCareerIsToldToTheEngineTests
    {
        private static readonly string Source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

        [Fact]
        public void a_kept_career_is_reported_before_it_is_handed_on()
        {
            var body = CurrencyDelaySourceText.MethodBody(Source, "private static Dictionary<string, object?>? CareerBuiltOrKept(double ut)");

            var reported = body.IndexOf("GroupReused?.Invoke(SnapshotGroups.Career);", StringComparison.Ordinal);
            var handedOn = body.IndexOf("return kept;", StringComparison.Ordinal);
            Assert.True(reported >= 0 && handedOn > reported, "the engine must hear of a kept career before it is returned");
        }

        [Fact]
        public void with_no_engine_every_sample_builds_the_career()
        {
            var body = CurrencyDelaySourceText.MethodBody(Source, "private static Dictionary<string, object?>? CareerBuiltOrKept(double ut)");

            Assert.Contains("FullSampleGate?.Invoke() ?? true", body, StringComparison.Ordinal);
        }

        [Fact]
        public void the_career_events_are_hooked_and_unhooked()
        {
            Assert.Contains("HookCareerEvents(add: true);", Source, StringComparison.Ordinal);
            Assert.Contains("HookCareerEvents(add: false);", Source, StringComparison.Ordinal);
        }
    }
}
