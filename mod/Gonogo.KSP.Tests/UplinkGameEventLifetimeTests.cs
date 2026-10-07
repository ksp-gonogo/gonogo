using System;
using System.IO;
using System.Linq;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// That an uplink's GameEvents hooks outlive the main menu.
    ///
    /// <para>The host addon is <c>KSPAddon(Instantly, once)</c> and DontDestroyOnLoad, so
    /// <c>Register</c> runs once per process, during LOADING. KSP fires
    /// <c>onGameSceneLoadRequested(MAINMENU)</c> on the LOADING to MAINMENU transition that
    /// follows, so a handler that unhooks on that request runs at boot, before any game is
    /// loaded, and nothing re-hooks. The crash, recovery and flight-end producers did that
    /// and published nothing in any session.</para>
    ///
    /// <para>Source text, not behaviour: these uplinks read live KSP and cannot be compiled
    /// into this project, the same reason <c>DerivedCurrencyArmIsWiredTests</c> reads
    /// source.</para>
    /// </summary>
    public class UplinkGameEventLifetimeTests
    {
        [Theory]
        [InlineData("CrashUplink.cs")]
        [InlineData("RecoveryUplink.cs")]
        [InlineData("FlightUplink.cs")]
        public void a_process_wide_producer_never_stands_down_on_a_scene_load_request(string file)
        {
            var source = CurrencyDelaySourceText.ReadRelative(file);

            Assert.DoesNotContain("onGameSceneLoadRequested", source, StringComparison.Ordinal);
            Assert.DoesNotContain("GameScenes.MAINMENU", source, StringComparison.Ordinal);
        }

        [Theory]
        [InlineData("CrashUplink.cs")]
        [InlineData("RecoveryUplink.cs")]
        [InlineData("FlightUplink.cs")]
        public void the_producer_hooks_when_it_registers(string file)
        {
            var source = CurrencyDelaySourceText.ReadRelative(file);
            var register = CurrencyDelaySourceText.MethodBody(source, "public void Register(IUplinkHost host)");

            Assert.Contains("HookGameEvents()", register, StringComparison.Ordinal);
        }

        /// <summary>
        /// Every file that subscribes to the scene-load request is listed with why its
        /// handler is safe, so a new one cannot reintroduce the stand-down unnoticed.
        /// </summary>
        [Fact]
        public void every_scene_load_subscriber_is_accounted_for()
        {
            var accounted = new[]
            {
                // Re-arms its hooks and the withholding bind on every non-menu load
                "CurrencyEventUplink.cs",
                // Tracks the phase of the load itself and unhooks nothing else
                "GameLoadReporter.cs",
                // Removes its subscriptions only from the addon's own teardown
                "KspHost.cs",
            };

            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "mod", "Gonogo.KSP")))
            {
                dir = dir.Parent;
            }
            Assert.NotNull(dir);

            var subscribers = Directory
                .EnumerateFiles(Path.Combine(dir!.FullName, "mod", "Gonogo.KSP"), "*.cs", SearchOption.AllDirectories)
                .Where(f => File.ReadAllText(f).Contains("onGameSceneLoadRequested.Add", StringComparison.Ordinal))
                .Select(f => Path.GetFileName(f))
                .OrderBy(n => n, StringComparer.Ordinal)
                .ToList();

            Assert.Equal(accounted.OrderBy(n => n, StringComparer.Ordinal), subscribers);
        }
    }
}
