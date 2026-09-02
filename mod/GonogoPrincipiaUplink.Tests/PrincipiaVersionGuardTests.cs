using System;
using System.Linq;
using System.Reflection;
using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The detection guard, whose PRIMARY live case is the mod being absent.
    ///
    /// <para>Every assertion here runs with no Principia installed, which is not a
    /// limitation of the test but the state the rig is actually in. An Uplink for
    /// an optional mod has to be correct when the mod is missing before its
    /// present-case is worth anything.</para>
    /// </summary>
    public class PrincipiaVersionGuardTests
    {
        [Fact]
        public void AnAbsentAssemblyIsUnavailableAndSaysSo()
        {
            var result = PrincipiaVersionGuard.Probe(null);

            Assert.False(result.IsAvailable);
            Assert.Equal("Principia not loaded", result.Reason);
            Assert.Null(result.DetectedVersion);
        }

        [Fact]
        public void ProbingTheLiveAppDomainIsUnavailableHereRatherThanThrowing()
        {
            // The live path, exercised for real: no Principia in a test process, so
            // it must answer unavailable rather than throw while enumerating.
            var result = PrincipiaVersionGuard.ProbeLoaded();

            Assert.False(result.IsAvailable);
            Assert.NotNull(result.Reason);
        }

        [Fact]
        public void AnAssemblyWithTheWrongNameIsRefusedRatherThanAccepted()
        {
            // The reason the name is matched EXACTLY rather than by prefix: some
            // other assembly must not be able to pass as Principia's adapter.
            var result = PrincipiaVersionGuard.Probe(typeof(PrincipiaVersionGuardTests).Assembly);

            Assert.False(result.IsAvailable);
            Assert.Contains("not Principia's adapter assembly", result.Reason);
        }

        [Fact]
        public void TheGuardNeverBindsAMember()
        {
            // The load-bearing property of this whole Uplink, asserted rather than
            // documented: Principia's surviving native surface aborts the KSP
            // PROCESS on a bad call, so a guard that probed members would be
            // trading a missing widget for a dead game.
            //
            // Checked structurally because there is no behaviour to observe: the
            // absence of calls is the thing.
            //
            // Comments are STRIPPED first. The guard's own doc comment names
            // `[DllImport]` and `dlsym` in order to say it does not use them, so
            // asserting against the raw file matched the prose explaining the
            // rule rather than a violation of it. Same trap as counting
            // `.magnitude` in comments that discuss `.magnitude`.
            var source = CodeOf("PrincipiaVersionGuard.cs");

            Assert.DoesNotContain("GetMethod", source);
            Assert.DoesNotContain("GetType(", source);
            Assert.DoesNotContain("Invoke", source);
            Assert.DoesNotContain("DllImport", source);
            Assert.DoesNotContain("dlsym", source);
            // What it IS allowed to do.
            Assert.Contains("GetName()", source);
        }

        /// <summary>The file with every comment line removed, so an assertion about CODE cannot match prose.</summary>
        private static string CodeOf(string fileName)
        {
            var lines = SourceOf(fileName).Split('\n');
            var code = new System.Text.StringBuilder();
            foreach (var line in lines)
            {
                var trimmed = line.TrimStart();
                if (trimmed.StartsWith("//", StringComparison.Ordinal)) continue;
                code.Append(line).Append('\n');
            }
            return code.ToString();
        }

        private static string SourceOf(string fileName)
        {
            var dir = AppContext.BaseDirectory;
            while (dir != null && !System.IO.Directory.Exists(
                System.IO.Path.Combine(dir, "mod", "GonogoPrincipiaUplink")))
            {
                dir = System.IO.Directory.GetParent(dir)?.FullName;
            }
            Assert.NotNull(dir);
            return System.IO.File.ReadAllText(
                System.IO.Path.Combine(dir!, "mod", "GonogoPrincipiaUplink", fileName));
        }
    }

    /// <summary>
    /// A stand-in for Principia's adapter assembly: name and version only, which
    /// is all this guard reads. Subclassing Assembly is the only way to present a
    /// chosen AssemblyName without shipping a real Principia DLL into the test.
    /// </summary>
    internal sealed class FakeAdapterAssembly : Assembly
    {
        private readonly AssemblyName _name;

        public FakeAdapterAssembly(string name, Version version)
        {
            _name = new AssemblyName(name) { Version = version };
        }

        public override AssemblyName GetName() => _name;
    }

    /// <summary>
    /// What the Uplink reports: presence, version, and one channel.
    /// </summary>
    public class PrincipiaUplinkTests
    {
        [Fact]
        public void DeclaresItsThreeChannelsAndNoAvailabilityTopic()
        {
            var manifest = new PrincipiaUplink().Manifest;

            Assert.Equal("principia", manifest.Id);
            Assert.Equal(
                new[]
                {
                    "principia.settings",
                    "principia.plan",
                    "principia.analysis",
                },
                manifest.Channels.Select(c => c.Topic).ToArray());

            // Presence still rides `system.uplinks` rather than a dedicated
            // availability topic: a client gates on a channel carrying a sample,
            // which is a stronger fact than the mod being loaded. Which Principia
            // build is loaded rides the same roster, as health, rather than the
            // `principia.conformance` topic that used to sit in this list: see
            // PrincipiaBinaryHealthTests.
            Assert.DoesNotContain(manifest.Channels, c => c.Topic!.EndsWith(".available"));
        }

        /// <summary>
        /// Absence on the plan channel must carry NO information, which is what
        /// <c>AbsenceIsData</c> false means. Asserted rather than left to the
        /// default: a missing sample is "no session, no plugin or no vessel", and a
        /// channel whose absence was data would license a client to read that
        /// silence as "this vessel has no flight plan", which is the reading that
        /// makes an operator stop looking. The positive observation of no plan is
        /// <c>planExists: false</c> on a sample that DID arrive.
        /// </summary>
        [Fact]
        public void AbsenceOnThePlanChannelIsNotData()
        {
            Assert.False(Channel("principia.plan").AbsenceIsData);
        }

        /// <summary>
        /// The two channels carry OPPOSITE delay roles, and the difference is the
        /// design rather than an oversight. A flight plan is an observation of a
        /// craft's future and rides the light-time delay like any other; the
        /// settings are ground-side facts about how the numbers are being
        /// computed, on the operator's own machine. Delaying those would mean someone
        /// adjusting a tolerance could not see the new basis for their readouts until
        /// light-time had passed.
        /// </summary>
        [Fact]
        public void ThePlanIsDelayedAndTheSettingsAreNot()
        {
            Assert.Equal(DelayRole.Delayed, Channel("principia.plan").Delay);
            Assert.Equal(DelayRole.TrueNow, Channel("principia.settings").Delay);
        }

        /// <summary>
        /// The window mirror is GONE, and this is the assertion that keeps it gone.
        ///
        /// <para>It read its fields off the producer's planner window, which refresh
        /// only while that window renders, so the channel answered only when the
        /// player happened to have that panel open. A telemetry channel may not have
        /// that property, however carefully its doc comment described it. Everything
        /// it carried is on <c>principia.plan</c>, from the plugin, except a
        /// first-error burn index that was never a fact about the plan: it held the
        /// index of the control the player last edited when an error came back.</para>
        /// </summary>
        [Fact]
        public void No_channel_here_is_fed_from_the_producers_planner_window()
        {
            Assert.DoesNotContain(
                new PrincipiaUplink().Manifest.Channels, c => c.Topic == "principia.flightPlan");
        }

        private static ChannelDeclaration Channel(string topic) =>
            new PrincipiaUplink().Manifest.Channels.Single(c => c.Topic == topic);

        [Fact]
        public void ReportsUnavailableWithAReasonWhenPrincipiaIsAbsent()
        {
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Fail("Principia not loaded"));

            var health = uplink.Health();

            Assert.Equal(UplinkHealthState.Unavailable, health.State);
            Assert.Equal("Principia not loaded", health.Detail);
        }

        [Fact]
        public void AcceptsTheVersionActuallyInstalledOnTheRig()
        {
            // Regression, and it exists because the first draft of this guard
            // FAILED it. That draft pinned majors 1..1 from an assumption about
            // Principia's version scheme; the installed adapter reads
            // 2026.08.12.215, so it would have reported a working install as
            // "outside known-good range".
            //
            // Observed by installing it and reading the assembly, not reasoned.
            var observed = Version.Parse(PrincipiaVersionGuard.ObservedAdapterVersion);
            var fake = new FakeAdapterAssembly(PrincipiaVersionGuard.AssemblyName, observed);

            var result = PrincipiaVersionGuard.Probe(fake);

            Assert.True(result.IsAvailable, result.Reason);
            Assert.Equal(observed, result.DetectedVersion);
        }

        /// <summary>
        /// The name is asserted as a LITERAL, never through the constant. Every
        /// other case here builds its double with
        /// <c>new FakeAdapterAssembly(PrincipiaVersionGuard.AssemblyName, ...)</c>,
        /// which feeds the subject its own answer: the assertion then holds for
        /// any value of the constant, right or wrong. It was wrong. It read
        /// <c>ksp_plugin_adapter</c> while the shipped adapter is
        /// <c>principia.ksp_plugin_adapter</c>, so the guard said "Principia not
        /// loaded" on an install where it was loaded, and this file was green
        /// throughout.
        ///
        /// <para>The literal below was read off the installed
        /// <c>ksp_plugin_adapter.dll</c> on the live rig, not reasoned about.</para>
        /// </summary>
        [Fact]
        public void MatchesTheNameTheShippedAdapterReallyHas()
        {
            Assert.Equal("principia.ksp_plugin_adapter", PrincipiaVersionGuard.AssemblyName);

            var shipped = new FakeAdapterAssembly(
                "principia.ksp_plugin_adapter",
                Version.Parse(PrincipiaVersionGuard.ObservedAdapterVersion));

            Assert.True(
                PrincipiaVersionGuard.Probe(shipped).IsAvailable,
                "the guard refused the name the shipped adapter really carries, so every "
                + "slice behind it stands down on a working install");

            // The bare word must NOT pass, which is what makes the assertion above
            // discriminating rather than merely true.
            var bare = new FakeAdapterAssembly(
                "ksp_plugin_adapter",
                Version.Parse(PrincipiaVersionGuard.ObservedAdapterVersion));

            Assert.False(PrincipiaVersionGuard.Probe(bare).IsAvailable);
        }

        [Fact]
        public void AcceptsAnyVersionOfTheAdapter()
        {
            // No gate, on purpose: this guard binds no member, so no release can
            // break it, and what we assert about Principia (integrated
            // trajectories, with a horizon) is true of every version. A date-based
            // scheme would make any pinned range need revisiting monthly.
            foreach (var v in new[] { new Version(1, 0), new Version(2026, 8, 12, 215), new Version(9999, 1) })
            {
                var result = PrincipiaVersionGuard.Probe(
                    new FakeAdapterAssembly(PrincipiaVersionGuard.AssemblyName, v));
                Assert.True(result.IsAvailable, "rejected " + v);
            }
        }

        [Fact]
        public void ReportsHealthyAndNamesTheVersionWhenPresent()
        {
            // The version is a fact row rather than part of the detail sentence it
            // used to be appended to. Same claim, moved: the roster still names
            // which Principia was detected, and now says so beside the rest of the
            // build's identity instead of inside the line that explains the state.
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Ok(new Version(1, 2, 3, 4)));

            var health = uplink.Health();

            Assert.Equal(UplinkHealthState.Healthy, health.State);
            Assert.Contains(health.Facts, f => f.Label == "version" && f.Value == "1.2.3.4");
        }

        [Fact]
        public void RegistersNothing()
        {
            // The increment boundary, asserted so increment 3 cannot quietly
            // arrive early: detection lands before anything changes a number
            // because of it. `Register` taking no action is the deliverable.
            var source = System.IO.File.ReadAllText(UplinkSourcePath());
            var register = source.Substring(source.IndexOf("public void Register", StringComparison.Ordinal));
            var body = register.Substring(0, register.IndexOf("}", StringComparison.Ordinal));

            Assert.DoesNotContain("RegisterProvider", body);
            Assert.DoesNotContain("AddChannelSource", body);
        }

        private static string UplinkSourcePath()
        {
            var dir = AppContext.BaseDirectory;
            while (dir != null && !System.IO.Directory.Exists(
                System.IO.Path.Combine(dir, "mod", "GonogoPrincipiaUplink")))
            {
                dir = System.IO.Directory.GetParent(dir)?.FullName;
            }
            Assert.NotNull(dir);
            return System.IO.Path.Combine(dir!, "mod", "GonogoPrincipiaUplink", "PrincipiaUplink.cs");
        }
    }
}
