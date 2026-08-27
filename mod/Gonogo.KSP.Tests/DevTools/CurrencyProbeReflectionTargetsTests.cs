using System;
using System.IO;
using System.Reflection;
using Gonogo.KSP.CurrencyDelay;
using Sitrep.Host.Comms;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>
    /// Every production member <c>GonogoDevCurrency</c>'s ROUTE probe reaches by
    /// reflection, checked here so a rename cannot quietly turn the probe's answers
    /// into "(unreadable)".
    ///
    /// <para><b>Why this is not optional.</b> The probe cannot reference Gonogo.dll,
    /// so every one of these reads is a string lookup that degrades to a null
    /// <c>MemberInfo</c> when it misses. The degrade is deliberate - a missed read
    /// must never render as a measured zero - but it means a renamed member costs
    /// nothing at build time, nothing at run time, and shows up only as a rig run
    /// that explains less than the last one did. That is precisely an instrument
    /// blind to its own failure, which is the shape of thing this subsystem has
    /// already been burnt by.</para>
    ///
    /// <para>The types that compile headlessly are reflected over for real. The two
    /// that cannot be (<c>KscLightTime</c> needs a live <c>Vessel</c>,
    /// <c>CommsCoreUplink</c> is only compiled under the KspManaged gate) are checked
    /// against their shipped SOURCE, the same discipline
    /// <c>AwayScienceArmIsWiredTests</c> uses for the interceptor.</para>
    /// </summary>
    public class CurrencyProbeReflectionTargetsTests
    {
        private const BindingFlags PublicInstance = BindingFlags.Public | BindingFlags.Instance;

        [Fact]
        public void KscDelay_still_exposes_the_three_members_the_probe_reads()
        {
            var type = typeof(KscDelay);

            Assert.NotNull(type.GetProperty("Kind", PublicInstance));
            Assert.NotNull(type.GetProperty("IsUnroutable", PublicInstance));
            Assert.NotNull(type.GetProperty("Seconds", PublicInstance));
        }

        [Fact]
        public void Reading_Seconds_on_an_unroutable_delay_throws_so_the_probe_must_ask_IsUnroutable_first()
        {
            // The probe branches on IsUnroutable before touching Seconds. If that ever
            // stopped being necessary the branch would look like dead defensiveness
            // and get deleted, so the necessity is pinned here.
            var unroutable = (object)KscDelay.Unroutable;
            var seconds = typeof(KscDelay).GetProperty("Seconds", PublicInstance);

            var thrown = Assert.Throws<TargetInvocationException>(() => seconds!.GetValue(unroutable, null));
            Assert.IsType<InvalidOperationException>(thrown.InnerException);
        }

        [Fact]
        public void KscDelayPolicy_DelaySeconds_is_still_an_internal_static_of_that_shape()
        {
            var method = typeof(KscDelayPolicy).GetMethod(
                "DelaySeconds", BindingFlags.NonPublic | BindingFlags.Static);

            Assert.NotNull(method);

            var parameters = method!.GetParameters();
            Assert.Equal(2, parameters.Length);
            Assert.Equal(typeof(KscDelay), parameters[0].ParameterType);
            Assert.Equal(typeof(SignalDelayConfig), parameters[1].ParameterType);
            Assert.Equal(typeof(double), method.ReturnType);
        }

        [Fact]
        public void SignalDelayConfig_still_exposes_the_four_fields_the_probe_reports()
        {
            var type = typeof(SignalDelayConfig);

            Assert.NotNull(type.GetProperty("Enabled", PublicInstance));
            Assert.NotNull(type.GetProperty("LightSpeedScale", PublicInstance));
            Assert.NotNull(type.GetProperty("SilenceDeclarationSeconds", PublicInstance));
            Assert.NotNull(type.GetProperty("CutForSimulation", PublicInstance));
        }

        [Fact]
        public void KscLightTime_still_offers_the_public_static_ForVessel_the_probe_invokes()
        {
            var source = ReadModSource(Path.Combine("Gonogo.KSP", "CurrencyDelay", "KscLightTime.cs"));

            Assert.Contains("public static KscDelay ForVessel(", source, StringComparison.Ordinal);
        }

        [Fact]
        public void CommsCoreUplink_still_offers_both_config_properties_the_probe_reads()
        {
            var source = ReadModSource(Path.Combine("Gonogo.KSP", "CommsCoreUplink.cs"));

            // EFFECTIVE is the one the currency arm consults; AUTHORED sits beside it
            // in the report so a simulation-cut delay is visible rather than looking
            // like a subsystem that never engaged.
            Assert.Contains("static SignalDelayConfig SignalDelayConfig", source, StringComparison.Ordinal);
            Assert.Contains("static SignalDelayConfig AuthoredSignalDelayConfig", source, StringComparison.Ordinal);
        }

        [Fact]
        public void The_currency_arm_still_reads_the_route_off_the_vessel_connection_the_probe_walks()
        {
            // The probe's RAW half is only an independent reading while it walks the
            // same primitive the arm does. If FleetCommsReader ever routes some other
            // way, the two halves stop being comparable and the probe's central
            // agree/disagree finding quietly becomes meaningless.
            var source = ReadModSource(Path.Combine("Gonogo.KSP", "FleetCommsReader.cs"));

            Assert.Contains("vessel.connection", source, StringComparison.Ordinal);
            Assert.Contains("conn.ControlPath", source, StringComparison.Ordinal);
        }

        [Fact]
        public void The_dev_comms_override_still_reaches_only_the_gate_and_the_connectivity_payload()
        {
            // The probe's override verdict is measured, not asserted, but the reason it
            // has to be measured is this: DevCommsOverride is consulted in
            // CommsCoreUplink and nowhere near the route read. If it ever grew a third
            // call site inside the routing path, a run that reads "NO" would be
            // reporting a regression rather than the design.
            var reader = ReadModSource(Path.Combine("Gonogo.KSP", "FleetCommsReader.cs"));
            var lightTime = ReadModSource(Path.Combine("Gonogo.KSP", "CurrencyDelay", "KscLightTime.cs"));

            Assert.DoesNotContain("DevCommsOverride", reader, StringComparison.Ordinal);
            Assert.DoesNotContain("DevCommsOverride", lightTime, StringComparison.Ordinal);
        }

        private static string ReadModSource(string relativePath)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod", relativePath);
                if (File.Exists(candidate))
                {
                    return File.ReadAllText(candidate);
                }
                dir = dir.Parent;
            }

            throw new FileNotFoundException(
                "Could not locate mod/" + relativePath + " from " + AppContext.BaseDirectory);
        }
    }
}
