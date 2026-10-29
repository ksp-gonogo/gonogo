using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP;
using UnityEngine;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class HullPointsTests
    {
        private static Matrix4x4 TurnedAboutX90()
        {
            var m = Matrix4x4.identity;
            m.m11 = 0f; m.m12 = -1f;
            m.m21 = 1f; m.m22 = 0f;
            return m;
        }

        // The stock tail fin: a root mesh and a control surface, both in the frame of a Base transform turned 90 degrees about X
        private static readonly Vector3[] FinRoot =
        {
            new Vector3(-0.119f, 0f, 0.548f), new Vector3(0.158f, 0f, -1.031f), new Vector3(-0.069f, 0f, 1.344f),
            new Vector3(0.206f, 0.07f, 1.039f), new Vector3(0.206f, -0.07f, -1.344f), new Vector3(0f, 0f, 0f),
        };

        private static readonly Vector3[] FinSurface =
        {
            new Vector3(1.4748f, 0f, -1.2309f), new Vector3(1.8711f, 0f, -0.6206f), new Vector3(0.206f, 0.06f, 1.231f),
            new Vector3(0.5f, 0f, 0.1f),
        };

        private static List<Vector3> TriplesToPoints(double[] flat)
        {
            var points = new List<Vector3>();
            for (var i = 0; i < flat.Length; i += 3)
            {
                points.Add(new Vector3((float)flat[i], (float)flat[i + 1], (float)flat[i + 2]));
            }
            return points;
        }

        [Fact]
        public void TheFinPublishesItsSweptCornersAndNotItsInterior()
        {
            var tracker = new HullPoints.Tracker();
            tracker.Add(FinRoot, TurnedAboutX90());
            tracker.Add(FinSurface, TurnedAboutX90());
            var triples = tracker.ToTriples();

            Assert.NotNull(triples);
            Assert.Equal(0, triples!.Length % 3);
            var points = TriplesToPoints(triples);
            Assert.InRange(points.Count, 4, HullPoints.MaxPointsPerPiece);

            // The outer tip corner, turned 90 degrees about X: (1.8711, 0, -0.6206) becomes (1.8711, 0.6206, 0)
            Assert.Contains(points, p => Mathf.Abs(p.x - 1.871f) < 0.002f && Mathf.Abs(p.y - 0.621f) < 0.002f);
            // An interior point of the control surface is not a hull corner
            Assert.DoesNotContain(points, p => Mathf.Abs(p.x - 0.5f) < 0.002f && Mathf.Abs(p.y - 0.1f) < 0.002f);
        }

        [Fact]
        public void PointsAreRoundedToAMillimetreAndNeverRepeated()
        {
            var cube = new[]
            {
                new Vector3(-1f, -1f, -1f), new Vector3(1f, -1f, -1f), new Vector3(-1f, 1f, -1f), new Vector3(1f, 1f, -1f),
                new Vector3(-1f, -1f, 1.00004f), new Vector3(1f, -1f, 1f), new Vector3(-1f, 1f, 1f), new Vector3(1f, 1f, 1f),
            };
            var tracker = new HullPoints.Tracker();
            tracker.Add(cube, Matrix4x4.identity);
            var triples = tracker.ToTriples()!;

            Assert.Equal(8 * 3, triples.Length);
            foreach (var value in triples)
            {
                Assert.Equal(System.Math.Round(value, 3), value);
            }
        }

        [Fact]
        public void ADenseCurvedMeshStaysUnderTheCap()
        {
            var ring = new List<Vector3>();
            for (var i = 0; i < 4000; i++)
            {
                var a = i * 0.0015707963f;
                ring.Add(new Vector3(Mathf.Cos(a) * 0.625f, (i % 2) - 0.5f, Mathf.Sin(a) * 0.625f));
            }

            var tracker = new HullPoints.Tracker();
            tracker.Add(HullPoints.Candidates(ring), Matrix4x4.identity);

            Assert.InRange(tracker.ToTriples()!.Length / 3, 8, HullPoints.MaxPointsPerPiece);
        }

        [Fact]
        public void ThinningAMeshKeepsItsExtremesAndDropsItsInterior()
        {
            var points = new List<Vector3>();
            for (var i = 0; i < 500; i++)
            {
                points.Add(new Vector3((i % 10) * 0.01f, (i % 7) * 0.01f, (i % 5) * 0.01f));
            }
            points.Add(new Vector3(3f, 0f, 0f));
            points.Add(new Vector3(-3f, 0f, 0f));

            var kept = HullPoints.Candidates(points);

            Assert.Contains(new Vector3(3f, 0f, 0f), kept);
            Assert.Contains(new Vector3(-3f, 0f, 0f), kept);
            Assert.True(kept.Length < 130);
        }

        private static List<Vector3> Revolved((float radius, float y)[] profile)
        {
            var mesh = new List<Vector3>();
            foreach (var (radius, y) in profile)
            {
                for (var i = 0; i < 32; i++)
                {
                    var angle = i * 2 * System.Math.PI / 32;
                    mesh.Add(new Vector3((float)(radius * System.Math.Cos(angle)), y, (float)(radius * System.Math.Sin(angle))));
                }
            }
            return mesh;
        }

        private static double[] Published(List<Vector3> mesh)
        {
            var tracker = new HullPoints.Tracker();
            tracker.Add(HullPoints.Candidates(mesh), Matrix4x4.identity);
            return tracker.ToTriples()!;
        }

        /// <summary>How far a point lies outside the 2D convex hull of the published points seen from `degrees` about the up axis, in metres.</summary>
        private static double Outside(double[] triples, double degrees, double lateral, double y)
        {
            var turn = degrees * System.Math.PI / 180;
            var seen = new List<(double lat, double y)>();
            for (var i = 0; i < triples.Length; i += 3)
            {
                seen.Add((triples[i] * System.Math.Cos(turn) + triples[i + 2] * System.Math.Sin(turn), triples[i + 1]));
            }

            double Cross((double lat, double y) o, (double lat, double y) a, (double lat, double y) b) =>
                (a.lat - o.lat) * (b.y - o.y) - (a.y - o.y) * (b.lat - o.lat);
            var sorted = seen.OrderBy(p => p.lat).ThenBy(p => p.y).ToList();
            List<(double lat, double y)> Chain(IEnumerable<(double lat, double y)> list)
            {
                var chain = new List<(double lat, double y)>();
                foreach (var p in list)
                {
                    while (chain.Count >= 2 && Cross(chain[^2], chain[^1], p) <= 1e-9)
                    {
                        chain.RemoveAt(chain.Count - 1);
                    }
                    chain.Add(p);
                }
                chain.RemoveAt(chain.Count - 1);
                return chain;
            }

            var hull = Chain(sorted).Concat(Chain(Enumerable.Reverse(sorted))).ToList();
            var inside = true;
            var nearest = double.MaxValue;
            for (var i = 0; i < hull.Count; i++)
            {
                var a = hull[i];
                var b = hull[(i + 1) % hull.Count];
                var ex = b.lat - a.lat;
                var ey = b.y - a.y;
                if (ex * (y - a.y) - ey * (lateral - a.lat) < -1e-9)
                {
                    inside = false;
                }
                var t = System.Math.Clamp(((lateral - a.lat) * ex + (y - a.y) * ey) / (ex * ex + ey * ey), 0, 1);
                nearest = System.Math.Min(nearest, System.Math.Sqrt(System.Math.Pow(lateral - (a.lat + t * ex), 2) + System.Math.Pow(y - (a.y + t * ey), 2)));
            }
            return inside ? 0 : nearest;
        }

        // A 1.25 m by 2 m cylinder whose edges are rounded by 0.2 m, as ProceduralParts builds a Fillet tank
        private static (float, float)[] FilletedCylinder()
        {
            var profile = new List<(float, float)>();
            foreach (var sign in new[] { -1f, 1f })
            {
                for (var k = 0; k <= 8; k++)
                {
                    var a = (float)System.Math.PI / 2 * (sign < 0 ? k : 8 - k) / 8;
                    profile.Add((0.425f + 0.2f * Mathf.Sin(a), sign * (0.8f + 0.2f * Mathf.Cos(a))));
                }
            }
            return profile.ToArray();
        }

        [Fact]
        public void ARoundedCylinderKeepsBothEndsOfEachFlatSide()
        {
            var points = TriplesToPoints(Published(Revolved(FilletedCylinder())));

            foreach (var (x, z) in new[] { (0.625f, 0f), (-0.625f, 0f), (0f, 0.625f), (0f, -0.625f) })
            {
                Assert.Contains(points, p => Mathf.Abs(p.x - x) < 0.002f && Mathf.Abs(p.z - z) < 0.002f && Mathf.Abs(p.y - 0.8f) < 0.002f);
                Assert.Contains(points, p => Mathf.Abs(p.x - x) < 0.002f && Mathf.Abs(p.z - z) < 0.002f && Mathf.Abs(p.y + 0.8f) < 0.002f);
            }
        }

        [Fact]
        public void ABulgedConeKeepsItsShoulderFromEverySide()
        {
            // 2 m across at the base and 1.25 m at the top, wider than a straight taper just under the top
            var cone = new (float, float)[] { (1f, -0.75f), (0.93f, -0.2f), (0.85f, 0.2f), (0.742f, 0.61f), (0.681f, 0.71f), (0.625f, 0.75f) };
            var published = Published(Revolved(cone));

            foreach (var degrees in new[] { 0, 30, 45, 60 })
            {
                foreach (var (radius, y) in cone)
                {
                    Assert.InRange(Outside(published, degrees, radius, y), 0, 0.045);
                    Assert.InRange(Outside(published, degrees, -radius, y), 0, 0.045);
                }
            }
        }

        private static double[] Box(double x, double y, double z, double size)
        {
            var flat = new List<double>();
            foreach (var sx in new[] { -1, 1 })
            {
                foreach (var sy in new[] { -1, 1 })
                {
                    foreach (var sz in new[] { -1, 1 })
                    {
                        flat.Add(x + sx * size / 2);
                        flat.Add(y + sy * size / 2);
                        flat.Add(z + sz * size / 2);
                    }
                }
            }
            return flat.ToArray();
        }

        [Fact]
        public void TheLargestPiecesAreKeptAndTheSmallestDroppedPastTheCaps()
        {
            var pieces = new List<double[]>();
            for (var i = 0; i < 14; i++)
            {
                pieces.Add(Box(i, 0, 0, 0.1 + i * 0.1));
            }

            var kept = HullPoints.Limit(pieces);

            Assert.Equal(HullPoints.MaxPieces, kept.Count);
            Assert.Equal(1.4, kept[0][12] - kept[0][0], 3);
            Assert.DoesNotContain(kept, piece => System.Math.Abs(piece[12] - piece[0] - 0.1) < 1e-6);
        }

        [Fact]
        public void PiecesStopBeingAddedWhenTheirPointsWouldPassTheTotalCap()
        {
            var pieces = new List<double[]>();
            for (var i = 0; i < 4; i++)
            {
                var round = new List<double>();
                for (var p = 0; p < 30; p++)
                {
                    round.Add(i + p * 0.01);
                    round.Add(p * 0.02);
                    round.Add(0);
                }
                pieces.Add(round.ToArray());
            }

            var kept = HullPoints.Limit(pieces);

            Assert.True(kept.Sum(piece => piece.Length / 3) <= HullPoints.MaxPoints);
            Assert.Equal(3, kept.Count);
        }

        [Fact]
        public void NothingAddedPublishesNothing()
        {
            Assert.Null(new HullPoints.Tracker().ToTriples());
        }
    }
}
