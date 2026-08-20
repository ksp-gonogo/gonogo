using System;
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
    /// What the Uplink reports, which for increment 1 is the entire deliverable:
    /// presence and version, elected nothing, changed no number.
    /// </summary>
    public class PrincipiaUplinkTests
    {
        [Fact]
        public void DeclaresNoChannels()
        {
            // Presence rides `system.uplinks`, so a dedicated availability topic
            // plus a client package to register it would be overhead for a
            // provider with no widget, the same reasoning a sibling client-less
            // uplink records for itself.
            Assert.Empty(new PrincipiaUplink().Manifest.Channels);
            Assert.Equal("principia", new PrincipiaUplink().Manifest.Id);
        }

        [Fact]
        public void ReportsUnavailableWithAReasonWhenPrincipiaIsAbsent()
        {
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Fail("Principia not loaded"));

            var health = uplink.Health();

            Assert.Equal(UplinkHealthState.Unavailable, health.State);
            Assert.Equal("Principia not loaded", health.Detail);
        }

        [Fact]
        public void DistinguishesNotInstalledFromAnUnknownVersion()
        {
            // Two different situations wanting two different actions from an
            // operator, so they must not arrive as the same sentence.
            var absent = new PrincipiaUplink(PrincipiaGuardResult.Fail("Principia not loaded")).Health();
            var wrongVersion = new PrincipiaUplink(
                PrincipiaGuardResult.Fail("Principia 9.0.0.0 outside known-good range 1.x-1.x",
                    new Version(9, 0, 0, 0))).Health();

            Assert.Equal(UplinkHealthState.Unavailable, absent.State);
            Assert.Equal(UplinkHealthState.Unavailable, wrongVersion.State);
            Assert.NotEqual(absent.Detail, wrongVersion.Detail);
            Assert.Contains("outside known-good range", wrongVersion.Detail);
        }

        [Fact]
        public void ReportsHealthyAndNamesTheVersionWhenPresent()
        {
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Ok(new Version(1, 2, 3, 4)));

            var health = uplink.Health();

            Assert.Equal(UplinkHealthState.Healthy, health.State);
            Assert.Contains("1.2.3.4", health.Detail);
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
