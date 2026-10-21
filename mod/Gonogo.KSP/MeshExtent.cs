using System.Collections.Generic;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Grows an axis-aligned box over a set of mesh points carried through a
    /// transform. Used by <see cref="PartMeshBounds"/> to measure a part from
    /// its vertices, which stays tight when a mesh is turned against the part.
    /// </summary>
    internal static class MeshExtent
    {
        /// <summary>Grows <paramref name="lo"/> and <paramref name="hi"/> over every point of <paramref name="points"/> after <paramref name="transform"/>.</summary>
        public static void GrowOverPoints(IReadOnlyList<Vector3> points, Matrix4x4 transform, ref Vector3 lo, ref Vector3 hi)
        {
            for (var i = 0; i < points.Count; i++)
            {
                var p = transform.MultiplyPoint3x4(points[i]);
                lo = Vector3.Min(lo, p);
                hi = Vector3.Max(hi, p);
            }
        }

        /// <summary>Grows <paramref name="lo"/> and <paramref name="hi"/> over the eight corners of <paramref name="bounds"/> after <paramref name="transform"/>.</summary>
        public static void GrowOverCorners(Bounds bounds, Matrix4x4 transform, ref Vector3 lo, ref Vector3 hi)
        {
            for (var i = 0; i < 8; i++)
            {
                var corner = bounds.center + Vector3.Scale(bounds.extents, new Vector3(
                    (i & 1) == 0 ? -1f : 1f,
                    (i & 2) == 0 ? -1f : 1f,
                    (i & 4) == 0 ? -1f : 1f));
                var p = transform.MultiplyPoint3x4(corner);
                lo = Vector3.Min(lo, p);
                hi = Vector3.Max(hi, p);
            }
        }
    }
}
