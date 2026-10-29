using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The <c>parts.shape.&lt;key&gt;</c> namespace: the topic each kind of
    /// part's shape is published on, and the packing of its meshes into the
    /// <see cref="PartShape"/> wire form.
    /// </summary>
    public static class PartShapeWire
    {
        /// <summary>The namespace every part shape's topic sits under.</summary>
        public const string Prefix = "parts.shape.";

        /// <summary>The largest value a packed coordinate or index takes.</summary>
        public const int PackedMax = ushort.MaxValue;

        /// <summary>
        /// The key for a part named <paramref name="name"/> in
        /// <paramref name="variant"/>: the escaped name, then a dot and the
        /// escaped variant when there is one. Each is one topic segment, escaped
        /// as <see cref="CraftFileTopic.EscapeSegment"/> escapes a file name.
        /// </summary>
        public static string Key(string name, string? variant) =>
            string.IsNullOrEmpty(variant)
                ? CraftFileTopic.EscapeSegment(name)
                : CraftFileTopic.EscapeSegment(name) + "." + CraftFileTopic.EscapeSegment(variant!);

        /// <summary>
        /// The part name and variant a <see cref="Key"/> was made from, or
        /// <c>false</c> when <paramref name="key"/> is not one: more than two
        /// segments, an empty one, or an escape that is not two hexadecimal digits.
        /// </summary>
        public static bool TryParseKey(string key, out string name, out string? variant)
        {
            name = "";
            variant = null;
            var segments = key.Split('.');
            if (segments.Length < 1 || segments.Length > 2)
            {
                return false;
            }
            if (!TryUnescape(segments[0], out name) || name.Length == 0)
            {
                return false;
            }
            if (segments.Length == 2)
            {
                if (!TryUnescape(segments[1], out var v) || v.Length == 0)
                {
                    return false;
                }
                variant = v;
            }
            return true;
        }

        private static bool TryUnescape(string segment, out string value)
        {
            value = "";
            var bytes = new List<byte>(segment.Length);
            for (var i = 0; i < segment.Length; i++)
            {
                var c = segment[i];
                if (c != '%')
                {
                    if (c >= 0x80)
                    {
                        return false;
                    }
                    bytes.Add((byte)c);
                    continue;
                }
                if (i + 2 >= segment.Length
                    || !byte.TryParse(segment.Substring(i + 1, 2), System.Globalization.NumberStyles.AllowHexSpecifier, System.Globalization.CultureInfo.InvariantCulture, out var b))
                {
                    return false;
                }
                bytes.Add(b);
                i += 2;
            }
            value = System.Text.Encoding.UTF8.GetString(bytes.ToArray());
            return true;
        }

        /// <summary>One mesh ready for packing: points in the part's frame and three indices per triangle.</summary>
        public sealed class Mesh
        {
            public Mesh(string key, bool shown, float[] positions, int[] triangles, int sourceTriangles)
            {
                Key = key;
                Shown = shown;
                Positions = positions;
                Triangles = triangles;
                SourceTriangles = sourceTriangles;
            }

            public string Key { get; }

            public bool Shown { get; }

            public float[] Positions { get; }

            public int[] Triangles { get; }

            public int SourceTriangles { get; }
        }

        /// <summary>
        /// Packs <paramref name="meshes"/> into a <see cref="PartShape"/>. A mesh
        /// with more points than a 16-bit index reaches is left out, since its
        /// triangles could not be written.
        /// </summary>
        public static PartShape Build(string name, string? variant, IEnumerable<Mesh> meshes)
        {
            var shape = new PartShape { Name = name, Variant = string.IsNullOrEmpty(variant) ? null : variant };
            foreach (var mesh in meshes)
            {
                if (Pack(mesh) is { } packed)
                {
                    shape.Meshes.Add(packed);
                }
            }
            return shape;
        }

        /// <summary>The mesh packed into its box, or null when it has more points than a 16-bit index reaches.</summary>
        public static PartShapeMesh? Pack(Mesh mesh)
        {
            var count = mesh.Positions.Length / 3;
            if (count > PackedMax + 1)
            {
                return null;
            }

            var lo = new double[] { double.MaxValue, double.MaxValue, double.MaxValue };
            var hi = new double[] { double.MinValue, double.MinValue, double.MinValue };
            for (var i = 0; i < count * 3; i++)
            {
                var axis = i % 3;
                lo[axis] = Math.Min(lo[axis], mesh.Positions[i]);
                hi[axis] = Math.Max(hi[axis], mesh.Positions[i]);
            }
            if (count == 0)
            {
                lo = new double[3];
                hi = new double[3];
            }

            /*
             * The box is rounded out to the tenth of a millimetre the wire
             * carries it in, before the points are packed against it, so the
             * points decode against exactly the box that was sent.
             */
            for (var axis = 0; axis < 3; axis++)
            {
                lo[axis] = Math.Floor(lo[axis] * 10000.0) / 10000.0;
                hi[axis] = Math.Ceiling(hi[axis] * 10000.0) / 10000.0;
            }

            var points = new byte[count * 6];
            for (var i = 0; i < count * 3; i++)
            {
                var axis = i % 3;
                var span = hi[axis] - lo[axis];
                var q = span > 0 ? (int)Math.Round((mesh.Positions[i] - lo[axis]) / span * PackedMax) : 0;
                q = Math.Max(0, Math.Min(PackedMax, q));
                points[i * 2] = (byte)(q & 0xff);
                points[i * 2 + 1] = (byte)(q >> 8);
            }

            var indices = new byte[mesh.Triangles.Length * 2];
            for (var i = 0; i < mesh.Triangles.Length; i++)
            {
                var v = mesh.Triangles[i];
                indices[i * 2] = (byte)(v & 0xff);
                indices[i * 2 + 1] = (byte)(v >> 8);
            }

            return new PartShapeMesh
            {
                Key = mesh.Key,
                Shown = mesh.Shown,
                Min = new Vec3(lo[0], lo[1], lo[2]),
                Max = new Vec3(hi[0], hi[1], hi[2]),
                Positions = Convert.ToBase64String(points),
                Indices = Convert.ToBase64String(indices),
                SourceTriangles = mesh.SourceTriangles,
            };
        }

        /// <summary>The dictionary tree the stream's JSON writer takes for <paramref name="shape"/>.</summary>
        public static Dictionary<string, object?> ToWire(PartShape shape) => new Dictionary<string, object?>
        {
            ["name"] = shape.Name,
            ["variant"] = shape.Variant,
            ["meshes"] = shape.Meshes.Select(m => (object?)ToWire(m)).ToList(),
        };

        private static Dictionary<string, object?> ToWire(PartShapeMesh mesh) => new Dictionary<string, object?>
        {
            ["key"] = mesh.Key,
            ["shown"] = mesh.Shown,
            ["min"] = ToWire(mesh.Min),
            ["max"] = ToWire(mesh.Max),
            ["positions"] = mesh.Positions,
            ["indices"] = mesh.Indices,
            ["sourceTriangles"] = mesh.SourceTriangles,
        };

        private static Dictionary<string, object?> ToWire(Vec3 v) => new Dictionary<string, object?>
        {
            ["x"] = v.X,
            ["y"] = v.Y,
            ["z"] = v.Z,
        };
    }
}
