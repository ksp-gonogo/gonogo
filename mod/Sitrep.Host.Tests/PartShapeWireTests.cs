using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class PartShapeWireTests
    {
        private static readonly float[] Points =
        {
            -0.625f, -0.8f, -0.625f,
            0.625f, -0.8f, -0.625f,
            0f, 0.83f, 0.3125f,
            0.1f, 0.2f, 0.3f,
        };

        private static readonly int[] Triangles = { 0, 1, 2, 0, 2, 3 };

        private static PartShapeMesh Packed() =>
            PartShapeWire.Pack(new PartShapeWire.Mesh("obj_gimbal/engine", true, Points, Triangles, 840))!;

        [Theory]
        [InlineData("fuelTank", null, "fuelTank")]
        [InlineData("liquidEngine2.v2", "Shroud", "liquidEngine2%2Ev2.Shroud")]
        [InlineData("Rockomax16.BW", "Bare Wall", "Rockomax16%2EBW.Bare%20Wall")]
        public void AKeyIsTheEscapedNameAndVariantAndReadsBack(string name, string? variant, string key)
        {
            Assert.Equal(key, PartShapeWire.Key(name, variant));
            Assert.True(PartShapeWire.TryParseKey(key, out var readName, out var readVariant));
            Assert.Equal(name, readName);
            Assert.Equal(variant, readVariant);
        }

        [Theory]
        [InlineData("")]
        [InlineData("a.b.c")]
        [InlineData("a.")]
        [InlineData("bad%2")]
        [InlineData("bad%ZZ")]
        public void AKeyNoPartCouldHaveIsRefused(string key)
        {
            Assert.False(PartShapeWire.TryParseKey(key, out _, out _));
        }

        [Fact]
        public void PointsDecodeToWithinATenthOfAMillimetre()
        {
            var mesh = Packed();
            var bytes = Convert.FromBase64String(mesh.Positions);
            Assert.Equal(Points.Length * 2, bytes.Length);
            var lo = new[] { mesh.Min.X, mesh.Min.Y, mesh.Min.Z };
            var hi = new[] { mesh.Max.X, mesh.Max.Y, mesh.Max.Z };
            for (var i = 0; i < Points.Length; i++)
            {
                var q = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
                var axis = i % 3;
                var decoded = lo[axis] + q / 65535.0 * (hi[axis] - lo[axis]);
                Assert.InRange(decoded, Points[i] - 1e-4, Points[i] + 1e-4);
            }
        }

        [Fact]
        public void TrianglesAreSixteenBitIndices()
        {
            var bytes = Convert.FromBase64String(Packed().Indices);
            var indices = Enumerable.Range(0, bytes.Length / 2).Select(i => bytes[i * 2] | (bytes[i * 2 + 1] << 8));
            Assert.Equal(Triangles, indices);
        }

        [Fact]
        public void APointOnAFlatAxisDecodesToTheBox()
        {
            var flat = PartShapeWire.Pack(new PartShapeWire.Mesh("plate", false, new float[] { 0, 0.5f, 0, 1, 0.5f, 0, 0, 0.5f, 1 }, new[] { 0, 1, 2 }, 1))!;
            var bytes = Convert.FromBase64String(flat.Positions);
            Assert.Equal(0.5, flat.Min.Y);
            Assert.Equal(0.5, flat.Max.Y);
            Assert.Equal(0, bytes[2] | (bytes[3] << 8));
        }

        [Fact]
        public void TheWireMirrorsTheContractTypes()
        {
            var shape = PartShapeWire.Build("liquidEngine2", null, new[] { new PartShapeWire.Mesh("obj_gimbal/engine", true, Points, Triangles, 840) });
            var wire = PartShapeWire.ToWire(shape);

            AssertKeysMatchType(typeof(PartShape), wire);
            var mesh = Assert.IsType<Dictionary<string, object?>>(Assert.Single(Assert.IsType<List<object?>>(wire["meshes"])));
            AssertKeysMatchType(typeof(PartShapeMesh), mesh);
            Assert.Equal("obj_gimbal/engine", mesh["key"]);
            Assert.Equal(840, mesh["sourceTriangles"]);
            Assert.Null(wire["variant"]);
        }

        private static void AssertKeysMatchType(Type type, Dictionary<string, object?> emitted)
        {
            var props = type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Select(p => char.ToLower(p.Name[0], CultureInfo.InvariantCulture) + p.Name.Substring(1))
                .OrderBy(k => k, StringComparer.Ordinal);
            Assert.Equal(props.ToArray(), emitted.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());
        }
    }
}
