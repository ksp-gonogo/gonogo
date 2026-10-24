using System;
using System.Collections.Generic;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The few points that carry a part's silhouette: the mesh vertices that
    /// reach furthest along a fixed set of directions, which are the corners of
    /// the mesh's convex hull wherever it has them. A part publishes one such
    /// piece per visible mesh, so a part whose meshes lie apart is not filled in
    /// between them. A consumer turns each piece by the part's rotation and
    /// keeps its 2D convex hull, so the outline is right from any side without
    /// the mod knowing the view.
    /// </summary>
    internal static class HullPoints
    {
        /// <summary>The most points one piece publishes.</summary>
        public const int MaxPointsPerPiece = 38;

        /// <summary>The most pieces a part publishes.</summary>
        public const int MaxPieces = 10;

        /// <summary>The most points a part publishes over all its pieces.</summary>
        public const int MaxPoints = 96;

        /// <summary>The coarser direction set a mesh's vertices are thinned with once, so each scan walks a few dozen candidates instead of every vertex.</summary>
        private const int CandidateDirections = 128;

        private const float Millimetre = 1000f;

        /// <summary>The 26 axis, edge and corner directions of a cube plus the 12 vertex directions of an icosahedron.</summary>
        public static readonly Vector3[] Directions = BuildDirections();

        private static readonly Vector3[] CandidateAxes = BuildFibonacci(CandidateDirections);

        /// <summary>
        /// The vertices of <paramref name="vertices"/> that are furthest along
        /// each of a fixed spread of directions, duplicates removed. Keeps the
        /// outline of the mesh while dropping the interior and the many vertices
        /// along a curved face.
        /// </summary>
        public static Vector3[] Candidates(IReadOnlyList<Vector3> vertices)
        {
            var picked = new HashSet<int>();
            foreach (var axis in CandidateAxes)
            {
                var best = -1;
                var bestDot = float.MinValue;
                for (var i = 0; i < vertices.Count; i++)
                {
                    var dot = Vector3.Dot(vertices[i], axis);
                    if (dot > bestDot)
                    {
                        bestDot = dot;
                        best = i;
                    }
                }

                if (best >= 0)
                {
                    picked.Add(best);
                }
            }

            var result = new Vector3[picked.Count];
            var at = 0;
            foreach (var index in picked)
            {
                result[at++] = vertices[index];
            }

            return result;
        }

        /// <summary>
        /// The pieces a part publishes: the largest <see cref="MaxPieces"/> of
        /// <paramref name="pieces"/>, fewer when their points would pass
        /// <see cref="MaxPoints"/>. What is dropped is the smallest pieces by
        /// their longest side, the knobs and hinges that add little to a part's
        /// outline. Each piece is a flat list of x, y, z triples.
        /// </summary>
        public static List<double[]> Limit(IReadOnlyList<double[]> pieces)
        {
            var bySize = new List<double[]>(pieces);
            bySize.Sort((a, b) => Longest(b).CompareTo(Longest(a)));
            var kept = new List<double[]>();
            var points = 0;
            foreach (var piece in bySize)
            {
                if (kept.Count == MaxPieces || points + piece.Length / 3 > MaxPoints)
                {
                    continue;
                }

                kept.Add(piece);
                points += piece.Length / 3;
            }

            return kept;
        }

        private static double Longest(double[] piece)
        {
            var lo = new[] { double.MaxValue, double.MaxValue, double.MaxValue };
            var hi = new[] { double.MinValue, double.MinValue, double.MinValue };
            for (var i = 0; i < piece.Length; i++)
            {
                lo[i % 3] = Math.Min(lo[i % 3], piece[i]);
                hi[i % 3] = Math.Max(hi[i % 3], piece[i]);
            }

            return Math.Max(hi[0] - lo[0], Math.Max(hi[1] - lo[1], hi[2] - lo[2]));
        }

        /// <summary>Collects the furthest point along each direction over the meshes of one piece.</summary>
        public sealed class Tracker
        {
            private readonly Vector3[] best = new Vector3[Directions.Length];
            private readonly float[] bestDot = new float[Directions.Length];

            public Tracker()
            {
                for (var i = 0; i < bestDot.Length; i++)
                {
                    bestDot[i] = float.MinValue;
                }
            }

            /// <summary>Adds the points of one mesh after <paramref name="transform"/> carried them into the part's frame.</summary>
            public void Add(IReadOnlyList<Vector3> points, Matrix4x4 transform)
            {
                for (var p = 0; p < points.Count; p++)
                {
                    var point = transform.MultiplyPoint3x4(points[p]);
                    for (var d = 0; d < Directions.Length; d++)
                    {
                        var dot = Vector3.Dot(point, Directions[d]);
                        if (dot > bestDot[d])
                        {
                            bestDot[d] = dot;
                            best[d] = point;
                        }
                    }
                }
            }

            /// <summary>
            /// The collected points as x, y, z triples in metres rounded to a
            /// millimetre, each point once, or <c>null</c> when nothing was added.
            /// </summary>
            public double[]? ToTriples()
            {
                var seen = new HashSet<(int, int, int)>();
                var flat = new List<double>();
                for (var d = 0; d < best.Length; d++)
                {
                    if (bestDot[d] == float.MinValue)
                    {
                        continue;
                    }

                    var key = (
                        (int)Math.Round(best[d].x * Millimetre),
                        (int)Math.Round(best[d].y * Millimetre),
                        (int)Math.Round(best[d].z * Millimetre));
                    if (!seen.Add(key))
                    {
                        continue;
                    }

                    flat.Add(key.Item1 / (double)Millimetre);
                    flat.Add(key.Item2 / (double)Millimetre);
                    flat.Add(key.Item3 / (double)Millimetre);
                }

                return flat.Count == 0 ? null : flat.ToArray();
            }
        }

        private static Vector3[] BuildDirections()
        {
            var list = new List<Vector3>();
            for (var x = -1; x <= 1; x++)
            {
                for (var y = -1; y <= 1; y++)
                {
                    for (var z = -1; z <= 1; z++)
                    {
                        if (x != 0 || y != 0 || z != 0)
                        {
                            list.Add(new Vector3(x, y, z).normalized);
                        }
                    }
                }
            }

            var phi = (1f + (float)Math.Sqrt(5.0)) / 2f;
            foreach (var a in new[] { -1f, 1f })
            {
                foreach (var b in new[] { -phi, phi })
                {
                    list.Add(new Vector3(0, a, b).normalized);
                    list.Add(new Vector3(a, b, 0).normalized);
                    list.Add(new Vector3(b, 0, a).normalized);
                }
            }

            return list.ToArray();
        }

        private static Vector3[] BuildFibonacci(int count)
        {
            var axes = new Vector3[count];
            var golden = Math.PI * (3.0 - Math.Sqrt(5.0));
            for (var i = 0; i < count; i++)
            {
                var y = 1.0 - 2.0 * (i + 0.5) / count;
                var radius = Math.Sqrt(1.0 - y * y);
                var angle = golden * i;
                axes[i] = new Vector3((float)(Math.Cos(angle) * radius), (float)y, (float)(Math.Sin(angle) * radius));
            }

            return axes;
        }
    }
}
