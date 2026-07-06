using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Conformance test for the C# <c>StubNetwork</c> port against the
    /// TS-computed golden fixtures in
    /// <c>mod/golden-fixtures/stub-network.json</c>. The fixture is generated
    /// by running the REAL TS <c>StubNetwork</c> in
    /// <c>mod/sitrep-server/src/stub-network.ts</c> over a set of scripted
    /// scenarios (`pnpm --filter @gonogo/sitrep-server gen:golden-fixtures`)
    /// — this test never hand-authors expected values, it only replays each
    /// scenario's ops against the C# port and asserts every query op
    /// reproduces the recorded expected result.
    ///
    /// A scenario constructs one <c>StubNetwork</c> (optional <c>defaults</c>
    /// + <c>scale</c> constructor args) then runs an ops list that interleaves
    /// mutations (<c>setDelay</c> / <c>setReachable</c> / <c>setScale</c>)
    /// with queries (<c>queryDelay</c> / <c>queryReachable</c>) — each query
    /// op carries the <c>expected</c> value the TS instance actually returned
    /// at that point in the sequence, so ordering (e.g. a query before and
    /// after a <c>setScale</c>) is preserved exactly.
    /// </summary>
    public class StubNetworkGoldenFixtureTests
    {
        private static readonly string FixturePath = Path.Combine(
            AppContext.BaseDirectory, "golden-fixtures", "stub-network.json");

        public static IEnumerable<object[]> Scenarios()
        {
            var json = File.ReadAllText(FixturePath);
            using var doc = JsonDocument.Parse(json);
            var scenarios = new List<object[]>();
            foreach (var element in doc.RootElement.EnumerateArray())
            {
                // Clone: the JsonDocument (and its elements) are invalidated
                // once this method returns and `doc` is disposed.
                scenarios.Add(new object[] { element.Clone() });
            }
            return scenarios;
        }

        [Theory]
        [MemberData(nameof(Scenarios))]
        public void MatchesTsReference(JsonElement scenario)
        {
            double? delay = null;
            bool? reachable = null;
            if (scenario.TryGetProperty("defaults", out var defaultsElement))
            {
                if (defaultsElement.TryGetProperty("delay", out var delayElement))
                {
                    delay = delayElement.GetDouble();
                }
                if (defaultsElement.TryGetProperty("reachable", out var reachableElement))
                {
                    reachable = reachableElement.GetBoolean();
                }
            }
            var scale = scenario.TryGetProperty("scale", out var scaleElement)
                ? scaleElement.GetDouble()
                : 1;

            var network = new StubNetwork(delay, reachable, scale);
            var name = scenario.GetProperty("name").GetString();

            foreach (var op in scenario.GetProperty("ops").EnumerateArray())
            {
                var kind = op.GetProperty("op").GetString();
                switch (kind)
                {
                    case "setDelay":
                        network.SetDelay(
                            op.GetProperty("vantage").GetString()!,
                            op.GetProperty("node").GetString()!,
                            op.GetProperty("seconds").GetDouble());
                        break;
                    case "setReachable":
                        network.SetReachable(
                            op.GetProperty("vantage").GetString()!,
                            op.GetProperty("node").GetString()!,
                            op.GetProperty("ok").GetBoolean());
                        break;
                    case "setScale":
                        network.SetScale(op.GetProperty("scale").GetDouble());
                        break;
                    case "queryDelay":
                    {
                        var vantage = op.GetProperty("vantage").GetString()!;
                        var node = op.GetProperty("node").GetString()!;
                        var expected = op.GetProperty("expected").GetDouble();
                        var actual = network.DelayTo(vantage, node);
                        Assert.True(
                            expected == actual,
                            $"[{name}] delayTo({vantage}, {node}) expected {expected} but got {actual}");
                        break;
                    }
                    case "queryReachable":
                    {
                        var vantage = op.GetProperty("vantage").GetString()!;
                        var node = op.GetProperty("node").GetString()!;
                        var expected = op.GetProperty("expected").GetBoolean();
                        var actual = network.Reachable(vantage, node);
                        Assert.True(
                            expected == actual,
                            $"[{name}] reachable({vantage}, {node}) expected {expected} but got {actual}");
                        break;
                    }
                    default:
                        throw new InvalidOperationException($"Unknown golden-fixture op: {kind}");
                }
            }
        }
    }
}
