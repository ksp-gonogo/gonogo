using System;
using System.IO;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// The two wiring facts the away-science arm depends on, neither of which any
    /// unit test can reach: <c>StockCurrencyInterceptor.cs</c> needs a live scene
    /// and is not compiled into this project at all.
    ///
    /// <para><b>Source text, not behaviour</b>, and for the reason
    /// <c>CurrencyDelaySettlePumpIsWiredTests</c> spells out: a test that calls the
    /// rule itself proves the rule works and says nothing about whether the shipped
    /// game reaches it. Both defects below lived in exactly that gap, and both were
    /// found on the rig rather than here.</para>
    /// </summary>
    public class AwayScienceArmIsWiredTests
    {
        /// <summary>
        /// The base a currency change was asked for comes off the modifier query
        /// that precedes it, and which query is evidence about which currency is
        /// <c>CurrencyQueryBases</c>'s rule. Held as loose fields on the
        /// interceptor it was one shared slot, and on an RP-1 install a second
        /// query fired between the real one and the change (Confidence pricing
        /// itself through <c>CurrencyUtils.Conf</c>, same reason, zero science)
        /// erased the base. The change then resolved AWAY with a base of zero and
        /// the arm did nothing at all.
        /// </summary>
        [Fact]
        public void the_interceptor_reads_its_query_bases_through_the_per_currency_rule()
        {
            var interceptor = ReadCurrencyDelaySource("StockCurrencyInterceptor.cs");

            Assert.Contains("CurrencyQueryBases", interceptor, StringComparison.Ordinal);

            // The single shared slot these named is what the rule replaced. Any of
            // them back means a query is once again evidence about every currency.
            Assert.DoesNotContain("_haveQuery", interceptor, StringComparison.Ordinal);
            Assert.DoesNotContain("_queryScience", interceptor, StringComparison.Ordinal);
        }

        /// <summary>
        /// An away credit may only be called unroutable after the guid has been
        /// looked up live. Ordinary transmitted science arrives carrying a
        /// ProtoVessel and no live vessel, so an arm that reaches for the
        /// <c>Unroutable</c> literal the moment its optional <c>liveOrigin</c> is
        /// null declares a perfectly linked craft unreachable and holds its science
        /// for a silence deadline rather than a light-time.
        /// </summary>
        [Fact]
        public void the_away_science_arm_resolves_the_origin_guid_before_calling_it_unroutable()
        {
            var body = MethodBody(
                ReadCurrencyDelaySource("StockCurrencyInterceptor.cs"),
                "private void ResolveScienceAway(");

            Assert.Contains("ResolveLiveDelay", body, StringComparison.Ordinal);
            Assert.DoesNotContain("KscDelay.Unroutable", body, StringComparison.Ordinal);
        }

        /// <summary>Returns the brace-matched body of the method whose declaration starts with <paramref name="declaration"/>.</summary>
        private static string MethodBody(string source, string declaration)
        {
            var declarationAt = source.IndexOf(declaration, StringComparison.Ordinal);
            Assert.True(declarationAt >= 0, "No '" + declaration + "' declaration found");

            var open = source.IndexOf('{', declarationAt);
            Assert.True(open >= 0, "No body found for '" + declaration + "'");

            var depth = 0;
            for (var i = open; i < source.Length; i++)
            {
                if (source[i] == '{')
                {
                    depth++;
                }
                else if (source[i] == '}' && --depth == 0)
                {
                    return source.Substring(open, i - open + 1);
                }
            }

            throw new InvalidOperationException("Unbalanced braces after '" + declaration + "'");
        }

        private static string ReadCurrencyDelaySource(string fileName)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod", "Gonogo.KSP", "CurrencyDelay", fileName);
                if (File.Exists(candidate))
                {
                    return File.ReadAllText(candidate);
                }
                dir = dir.Parent;
            }

            throw new FileNotFoundException(
                "Could not locate mod/Gonogo.KSP/CurrencyDelay/" + fileName + " from " + AppContext.BaseDirectory);
        }
    }
}
