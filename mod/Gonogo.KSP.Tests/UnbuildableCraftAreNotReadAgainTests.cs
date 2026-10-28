using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A saved craft that names a part this install lacks cannot become buildable until
    /// the game restarts, so a rescan, the once-a-minute full pass included, takes it
    /// from memory without loading its file, which is a parse and a collection's worth
    /// of garbage per craft on the main thread.
    ///
    /// <para>Source text, not behaviour: the scan reads live KSP and cannot be compiled
    /// into this project.</para>
    /// </summary>
    public class UnbuildableCraftAreNotReadAgainTests
    {
        private static readonly string Source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

        [Fact]
        public void an_unbuildable_craft_is_recalled_before_its_file_is_loaded()
        {
            var scan = CurrencyDelaySourceText.MethodBody(Source, "private static List<object?>? ScanSavedShips(double ut, bool wanted)");

            var recalled = scan.IndexOf("_unbuildableCraft.Recall(file, fileStamp)", StringComparison.Ordinal);
            var loaded = scan.IndexOf("ConfigNode.Load(file)", StringComparison.Ordinal);
            Assert.True(recalled >= 0 && loaded > recalled, "the unbuildable memo must be asked before the craft file is loaded");
        }
    }
}
