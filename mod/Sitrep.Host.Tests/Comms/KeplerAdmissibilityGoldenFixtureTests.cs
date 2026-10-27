using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// <see cref="KeplerAdmissibility"/> against
    /// <c>mod/golden-fixtures/kepler-admissibility.json</c>, which the browser's
    /// <c>keplerAdmissibility</c> wrote and is held to by its own vitest. The
    /// fixture carries the wire's shapes: angles in degrees, a figure as a number,
    /// a <c>{ magnitude }</c> wrapper or one of "NaN", "Infinity" and "-Infinity",
    /// and a missing key for an absent input.
    /// </summary>
    public class KeplerAdmissibilityGoldenFixtureTests
    {
        public static IEnumerable<object[]> Cases()
        {
            foreach (var c in Load().RootElement.GetProperty("cases").EnumerateArray())
            {
                yield return new object[] { c.GetProperty("id").GetString()!, c.GetRawText() };
            }
        }

        [Fact]
        public void TheFixtureCoversEveryCondition()
        {
            Assert.True(Load().RootElement.GetProperty("cases").GetArrayLength() >= 70);
        }

        [Theory]
        [MemberData(nameof(Cases))]
        public void TheTwinAnswersAsTheBrowserDoes(string id, string json)
        {
            using var doc = JsonDocument.Parse(json);
            var c = doc.RootElement;
            var decline = KeplerAdmissibility.Decline(
                Sample(c),
                Bodies(c),
                Number(c.GetProperty("viewUt")),
                Coast(c));

            var expected = c.GetProperty("expected");
            if (expected.TryGetProperty("ok", out _))
            {
                Assert.True(decline == null, id + ": expected admissible, the twin declined " + decline?.Reason + " " + decline?.Input + ": " + decline?.Note);
                return;
            }
            var declined = expected.GetProperty("declined");
            Assert.True(decline != null, id + ": expected a decline, the twin admitted it");
            Assert.Equal(declined.GetProperty("reason").GetString(), decline!.Reason);
            Assert.Equal(declined.GetProperty("input").GetString(), decline.Input);
            Assert.Equal(declined.TryGetProperty("note", out var note) ? note.GetString() : null, decline.Note);
        }

        private static JsonDocument Load([CallerFilePath] string source = "")
        {
            var path = Path.Combine(Path.GetDirectoryName(source)!, "..", "..", "golden-fixtures", "kepler-admissibility.json");
            return JsonDocument.Parse(File.ReadAllText(path));
        }

        private static ConicSample? Sample(JsonElement c)
        {
            if (!c.TryGetProperty("orbitPoint", out var point))
            {
                return null;
            }
            var quality = Enum.Parse<Quality>(point.GetProperty("quality").GetString()!);
            var payload = point.GetProperty("payload");
            return new ConicSample(Number(point.GetProperty("validAt")), quality, payload.ValueKind == JsonValueKind.Null ? null : Orbit(payload));
        }

        /// <summary>The payload as the mod holds it: radians, and a node or periapsis the orbit leaves undefined as 0.</summary>
        private static ConicOrbit Orbit(JsonElement o)
        {
            var ecc = Field(o, "ecc");
            var inc = Radians(Field(o, "inc"));
            var elements = new OrbitElements(
                Field(o, "sma"),
                ecc,
                inc,
                KeplerAdmissibility.NodeRadians(Optional(o, "lan") is double lan ? Radians(lan) : (double?)null, inc),
                KeplerAdmissibility.PeriapsisRadians(Optional(o, "argPe") is double argPe ? Radians(argPe) : (double?)null, ecc),
                Field(o, "meanAnomalyAtEpoch"),
                Field(o, "epoch"),
                Field(o, "mu"));
            double? transitionUt = null;
            if (o.TryGetProperty("encounter", out var encounter)
                && encounter.ValueKind == JsonValueKind.Object
                && !encounter.TryGetProperty("locked", out _))
            {
                transitionUt = Optional(encounter, "transitionUt");
            }
            PropagationHorizon? horizon = null;
            if (o.TryGetProperty("horizon", out var h) && h.ValueKind == JsonValueKind.Object)
            {
                horizon = new PropagationHorizon
                {
                    Kind = (PropagationHorizonKind)h.GetProperty("kind").GetInt32(),
                    TrajectoryKind = h.TryGetProperty("trajectoryKind", out var kind) ? (TrajectoryKind)kind.GetInt32() : TrajectoryKind.Unspecified,
                    UntilUt = Optional(h, "untilUt"),
                };
            }
            return new ConicOrbit(o.GetProperty("referenceBodyIndex").GetInt32(), elements, transitionUt, horizon);
        }

        private static IReadOnlyList<ConicBody>? Bodies(JsonElement c)
        {
            if (!c.TryGetProperty("bodies", out var bodies))
            {
                return null;
            }
            var list = new List<ConicBody>();
            foreach (var b in bodies.GetProperty("bodies").EnumerateArray())
            {
                double? depth = null;
                if (b.TryGetProperty("atmosphere", out var atmosphere) && atmosphere.ValueKind == JsonValueKind.Object)
                {
                    depth = Optional(atmosphere, "depth");
                }
                list.Add(new ConicBody(b.GetProperty("index").GetInt32(), Optional(b, "radius"), depth, Optional(b, "sphereOfInfluence")));
            }
            return list;
        }

        private static LoadedCoastEvidence? Coast(JsonElement c)
        {
            if (!c.TryGetProperty("coast", out var coast))
            {
                return null;
            }
            ConicThrust? thrust = null;
            if (coast.TryGetProperty("thrust", out var t))
            {
                thrust = new ConicThrust(Optional(t, "currentThrust"), Optional(t, "thrustStartedUt"), Optional(t, "lastThrustEndUt"));
            }
            List<ConicPendingCommand>? pending = null;
            if (coast.TryGetProperty("pending", out var p))
            {
                pending = new List<ConicPendingCommand>();
                foreach (var command in p.GetProperty("pending").EnumerateArray())
                {
                    pending.Add(new ConicPendingCommand(Optional(command, "dispatchedAt"), Optional(command, "oneWaySeconds")));
                }
            }
            return new LoadedCoastEvidence(thrust, pending);
        }

        /// <summary>A figure the wire may leave out, read as NaN when it is missing or null, as the browser reads it.</summary>
        private static double Field(JsonElement o, string name) => Optional(o, name) ?? double.NaN;

        private static double? Optional(JsonElement o, string name) =>
            o.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? Number(value) : (double?)null;

        private static double Number(JsonElement value)
        {
            switch (value.ValueKind)
            {
                case JsonValueKind.Number:
                    return value.GetDouble();
                case JsonValueKind.Object:
                    return Number(value.GetProperty("magnitude"));
                case JsonValueKind.String:
                    return value.GetString() switch
                    {
                        "NaN" => double.NaN,
                        "Infinity" => double.PositiveInfinity,
                        "-Infinity" => double.NegativeInfinity,
                        var other => throw new FormatException("not a number: " + other),
                    };
                default:
                    throw new FormatException("not a number: " + value.GetRawText());
            }
        }

        private static double Radians(double degrees) => degrees * Math.PI / 180;
    }
}
