using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// Saved craft exist in every game mode, so the scan behind
    /// <c>spaceCenter.savedShips</c> must not wait on a research tree. Read as source for the
    /// same reason <c>SandboxRecoveryIsWiredTests</c> is: the scan walks the live save's folders.
    /// </summary>
    public class SavedShipsAreReadInEveryGameModeTests
    {
        private const string ScanDeclaration = "private static List<object?>? ScanSavedShips(double ut, bool wanted)";

        [Fact]
        public void the_scan_does_not_depend_on_the_game_mode()
        {
            var source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");
            var scan = CurrencyDelaySourceText.MethodBody(source, ScanDeclaration);

            Assert.DoesNotContain("HasResearchTree", scan, StringComparison.Ordinal);
            Assert.DoesNotContain("game.Mode", scan, StringComparison.Ordinal);
        }
    }
}
