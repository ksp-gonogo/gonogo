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
