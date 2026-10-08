using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class HeldSampleCodecTests
    {
        private static string Wire(object? payload) => EnvelopeCodec.WriteStreamData(new StreamData<object?>
        {
            Topic = "x.y",
            Payload = payload,
            Meta = new Meta(),
        });

        private static object? RoundTrip(object? value)
        {
            var codec = new HeldSampleCodec();
            Assert.True(codec.TryPack(value, out var packed));
            return codec.Unpack(packed!);
        }

        [Fact]
        public void EveryNodeTypeComesBackAsItself()
        {
            var tree = new Dictionary<string, object?>
            {
                ["flag"] = true,
                ["off"] = false,
                ["nothing"] = null,
                ["whole"] = 7,
                ["wide"] = 1L << 40,
                ["real"] = 0.1 + 0.2,
                ["nan"] = double.NaN,
                ["text"] = "Kerbin \u00fc \u00e9",
                ["vec"] = new double[] { 1.5, -2.5, 3.5 },
                ["items"] = new List<object?> { 1, "two", 3.0, null, new List<object?>() },
                ["nested"] = new Dictionary<string, object?> { ["b"] = 1, ["a"] = 2, ["c"] = 3 },
            };

            var back = Assert.IsType<Dictionary<string, object?>>(RoundTrip(tree));

            Assert.Equal(tree.Keys, back.Keys);
            Assert.IsType<bool>(back["flag"]);
            Assert.IsType<int>(back["whole"]);
            Assert.IsType<long>(back["wide"]);
            Assert.IsType<double>(back["real"]);
            Assert.True(double.IsNaN((double)back["nan"]!));
            Assert.Equal(0.1 + 0.2, (double)back["real"]!);
            Assert.Equal("Kerbin \u00fc \u00e9", back["text"]);
            Assert.IsType<double[]>(back["vec"]);
            Assert.IsType<List<object?>>(back["items"]);
            Assert.Equal(new[] { "b", "a", "c" }, ((Dictionary<string, object?>)back["nested"]!).Keys);
            Assert.Equal(Wire(tree), Wire(back));
        }

        [Fact]
        public void ALargeTreeIsDeflatedAndStillWritesTheSameWire()
        {
            var parts = new List<object?>();
            for (var i = 0; i < 68; i++)
            {
                parts.Add(new Dictionary<string, object?>
                {
                    ["id"] = "42000" + i,
                    ["name"] = "fuelTank.long",
                    ["position"] = new double[] { i, i * 0.5, 0.0 },
                    ["dryMass"] = 0.84,
                    ["modules"] = new List<object?> { "ModuleFuelTanks", "ModuleCargoBay" },
                });
            }
            var tree = new Dictionary<string, object?> { ["parts"] = parts };

            var codec = new HeldSampleCodec();
            Assert.True(codec.TryPack(tree, out var packed));
            Assert.True(packed!.Length * 8 < Wire(tree).Length, "packed " + packed.Length + " against wire " + Wire(tree).Length);
            Assert.Equal(Wire(tree), Wire(codec.Unpack(packed)));
        }

        [Fact]
        public void ATreeHoldingAnythingElseIsNotPacked()
        {
            var codec = new HeldSampleCodec();
            Assert.False(codec.TryPack(new Dictionary<string, object?> { ["when"] = DateTime.UtcNow }, out var packed));
            Assert.Null(packed);
            Assert.False(codec.TryPack(new Dictionary<string, object?> { ["items"] = new List<string> { "a" } }, out _));
            Assert.False(codec.TryPack(new Dictionary<string, object?> { ["k"] = new Dictionary<string, double>() }, out _));
            Assert.False(codec.TryPack(new Vec3(), out _));
        }

        [Fact]
        public void TheScratchStreamIsReusableAcrossPacks()
        {
            var codec = new HeldSampleCodec();
            Assert.True(codec.TryPack("a long string " + new string('x', 400), out var first));
            Assert.True(codec.TryPack("b", out var second));
            Assert.Equal("b", codec.Unpack(second!));
            Assert.Equal("a long string " + new string('x', 400), codec.Unpack(first!));
        }
    }
}
