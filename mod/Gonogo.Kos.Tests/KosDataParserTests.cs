using System.Collections.Generic;
using Gonogo.Kos;
using Xunit;

namespace Gonogo.Kos.Tests
{
    /// <summary>
    /// Headless tests for the pure <c>[KOSDATA]</c> parser — the C# port of
    /// the app-side <c>kos-data-parser.ts</c> (spec §4(b)). Asserts the
    /// grammar + coercion stay byte-identical to the TS so the client sees the
    /// same values after the migration.
    /// </summary>
    public class KosDataParserTests
    {
        [Fact]
        public void ParseTopics_BareBlock_KeyedUnderDefault()
        {
            var result = KosDataParser.ParseTopics("noise [KOSDATA]a=1;b=2[/KOSDATA] trailing");

            Assert.Single(result);
            var fields = result[KosDataParser.DefaultTopic];
            Assert.Equal(1.0, fields["a"]);
            Assert.Equal(2.0, fields["b"]);
        }

        [Fact]
        public void ParseTopics_TopicTagged_KeyedUnderTopic()
        {
            var result = KosDataParser.ParseTopics("[KOSDATA:ship-map]parts=[];count=3[/KOSDATA]");

            Assert.True(result.ContainsKey("ship-map"));
            var fields = result["ship-map"];
            Assert.Equal("[]", fields["parts"]);
            Assert.Equal(3.0, fields["count"]);
        }

        [Fact]
        public void ParseTopics_MultipleTopics_EachReturned()
        {
            var result = KosDataParser.ParseTopics(
                "[KOSDATA:a]x=1[/KOSDATA][KOSDATA:b]y=2[/KOSDATA]");

            Assert.Equal(2, result.Count);
            Assert.Equal(1.0, result["a"]["x"]);
            Assert.Equal(2.0, result["b"]["y"]);
        }

        [Fact]
        public void ParseTopics_SameTopicTwice_LastWins()
        {
            var result = KosDataParser.ParseTopics(
                "[KOSDATA:t]v=1[/KOSDATA][KOSDATA:t]v=99[/KOSDATA]");

            Assert.Equal(99.0, result["t"]["v"]);
        }

        [Fact]
        public void ParseTopics_NoBlock_ReturnsEmpty()
        {
            Assert.Empty(KosDataParser.ParseTopics("just some kOS REPL noise"));
        }

        [Theory]
        [InlineData("true", true)]
        [InlineData("false", false)]
        public void Coerce_Booleans(string raw, bool expected)
        {
            Assert.Equal(expected, KosDataParser.Coerce(raw));
        }

        [Theory]
        [InlineData("0", 0.0)]
        [InlineData("-1.5", -1.5)]
        [InlineData("3e-2", 0.03)]
        [InlineData(".5", 0.5)]
        [InlineData("42", 42.0)]
        public void Coerce_Numbers(string raw, double expected)
        {
            Assert.Equal(expected, (double)KosDataParser.Coerce(raw));
        }

        [Theory]
        [InlineData("NaN")]
        [InlineData("")]
        [InlineData("hello")]
        [InlineData("{\"k\":1}")]
        public void Coerce_NonNumericStaysString(string raw)
        {
            Assert.Equal(raw, KosDataParser.Coerce(raw));
        }

        [Fact]
        public void ParseBody_SkipsBlankKeysAndNoEquals()
        {
            var fields = KosDataParser.ParseBody("=orphan;;good=1;   =blank");

            Assert.Single(fields);
            Assert.Equal(1.0, fields["good"]);
        }

        [Fact]
        public void StripAnsi_NoEscape_IsNoOp()
        {
            const string s = "plain [KOSDATA]a=1[/KOSDATA]";
            Assert.Same(s, KosDataParser.StripAnsi(s));
        }

        [Fact]
        public void ParseTopics_ToleratesAnsiSplitMarker()
        {
            // The wild case the TS parser handles: a cursor-move escape
            // injected mid-marker at a terminal wrap. Stripping ANSI before
            // the scan reunites the marker.
            var text = "[KOSDATA]a=1[/KOSDA\u001b[22;1HTA]";
            var result = KosDataParser.ParseTopics(text);

            Assert.Equal(1.0, result[KosDataParser.DefaultTopic]["a"]);
        }
    }
}
