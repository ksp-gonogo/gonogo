using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// One mesh's share of its part's box: the box over its points carried into
    /// the part's frame, a function of the mesh and that one matrix alone.
    /// </summary>
    internal sealed class MeshPiece
    {
        private MeshPiece(Vector3 lo, Vector3 hi, MeasurePath path, Matrix4x4 toPart)
        {
            Lo = lo;
            Hi = hi;
            Path = path;
            ToPart = toPart;
        }

        public Vector3 Lo { get; }

        public Vector3 Hi { get; }

        /// <summary>Whether the box came from the mesh's vertices or, with none readable, from its bounds.</summary>
        public MeasurePath Path { get; }

        public Matrix4x4 ToPart { get; }

        /// <summary>
        /// Measures a mesh from its <paramref name="vertices"/>, or from its
        /// <paramref name="bounds"/> when it has none, carried by <paramref name="toPart"/>.
        /// </summary>
        public static MeshPiece Measure(IReadOnlyList<Vector3>? vertices, Bounds bounds, Matrix4x4 toPart)
        {
            var lo = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var hi = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            var path = MeshExtent.Grow(vertices, bounds, toPart, ref lo, ref hi);
            return new MeshPiece(lo, hi, path, toPart);
        }
    }

    /// <summary>
    /// The <see cref="MeshPiece"/> last measured for each renderer, handed back while
    /// the renderer still draws the same mesh through exactly the same matrix into
    /// its part's frame, and measured again the moment either differs. A reused piece
    /// is therefore the one a fresh measurement would give.
    /// </summary>
    internal sealed class MeshPieceMemo<TOwner>
        where TOwner : class
    {
        private sealed class Entry
        {
            public object Mesh = null!;
            public MeshPiece Piece = null!;
        }

        private readonly ConditionalWeakTable<TOwner, Entry> _entries = new ConditionalWeakTable<TOwner, Entry>();

        /// <summary>How many pieces have been measured rather than reused.</summary>
        public int Measured { get; private set; }

        public MeshPiece Piece(TOwner owner, object mesh, Matrix4x4 toPart, Func<MeshPiece> measure)
        {
            if (_entries.TryGetValue(owner, out var entry)
                && ReferenceEquals(entry.Mesh, mesh)
                && SameMatrix(entry.Piece.ToPart, toPart))
            {
                return entry.Piece;
            }

            var piece = measure();
            Measured++;
            if (entry == null)
            {
                entry = new Entry();
                _entries.Add(owner, entry);
            }
            entry.Mesh = mesh;
            entry.Piece = piece;
            return piece;
        }

        /* Element by element, because Matrix4x4's own == is approximate and a near match is not the same piece. */
        private static bool SameMatrix(Matrix4x4 a, Matrix4x4 b)
        {
            for (var i = 0; i < 16; i++)
            {
                if (!a[i].Equals(b[i]))
                {
                    return false;
                }
            }
            return true;
        }
    }

    /// <summary>The box of a whole part, put together from its mesh pieces.</summary>
    internal static class PartBox
    {
        /// <summary>The box over every piece and how it was measured. False when there are no pieces.</summary>
        public static bool TryAssemble(IReadOnlyList<MeshPiece> pieces, out Vector3 center, out Vector3 size, out MeasurePath path)
        {
            center = Vector3.zero;
            size = Vector3.zero;
            path = MeasurePath.None;
            if (pieces.Count == 0)
            {
                return false;
            }

            var lo = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var hi = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            var fromVertices = 0;
            var fromBounds = 0;
            foreach (var piece in pieces)
            {
                lo = Vector3.Min(lo, piece.Lo);
                hi = Vector3.Max(hi, piece.Hi);
                if (piece.Path == MeasurePath.Vertices)
                {
                    fromVertices++;
                }
                else
                {
                    fromBounds++;
                }
            }

            path = fromBounds == 0 ? MeasurePath.Vertices : fromVertices == 0 ? MeasurePath.MeshBounds : MeasurePath.Mixed;
            center = (lo + hi) * 0.5f;
            size = hi - lo;
            return true;
        }

        /// <summary>
        /// The matrix carrying a mesh into its part's frame, from the local position,
        /// rotation and scale of each transform between them, the mesh's own first.
        /// Built from the hierarchy rather than from world matrices, so it does not
        /// move by a rounding error each time the vessel moves through the world.
        /// </summary>
        public static Matrix4x4 ToPart(IReadOnlyList<(Vector3 Position, Quaternion Rotation, Vector3 Scale)> fromMeshUp)
        {
            var carry = Matrix4x4.identity;
            for (var i = 0; i < fromMeshUp.Count; i++)
            {
                carry = Local(fromMeshUp[i].Position, fromMeshUp[i].Rotation, fromMeshUp[i].Scale) * carry;
            }
            return carry;
        }

        /// <summary>Translation, then rotation, then scale, as a Transform composes its local matrix.</summary>
        internal static Matrix4x4 Local(Vector3 position, Quaternion rotation, Vector3 scale)
        {
            float x = rotation.x, y = rotation.y, z = rotation.z, w = rotation.w;
            var norm = x * x + y * y + z * z + w * w;
            var s = norm > 0f ? 2f / norm : 0f;
            float xx = x * x * s, yy = y * y * s, zz = z * z * s;
            float xy = x * y * s, xz = x * z * s, yz = y * z * s;
            float wx = w * x * s, wy = w * y * s, wz = w * z * s;

            var m = Matrix4x4.identity;
            m.m00 = (1f - (yy + zz)) * scale.x;
            m.m10 = (xy + wz) * scale.x;
            m.m20 = (xz - wy) * scale.x;
            m.m01 = (xy - wz) * scale.y;
            m.m11 = (1f - (xx + zz)) * scale.y;
            m.m21 = (yz + wx) * scale.y;
            m.m02 = (xz + wy) * scale.z;
            m.m12 = (yz - wx) * scale.z;
            m.m22 = (1f - (xx + yy)) * scale.z;
            m.m03 = position.x;
            m.m13 = position.y;
            m.m23 = position.z;
            return m;
        }
    }
}
