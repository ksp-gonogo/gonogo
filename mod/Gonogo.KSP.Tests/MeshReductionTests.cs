using System;
using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class MeshReductionTests
    {
        /// <summary>A closed cylinder along y, finely cut so it has far more triangles than its shape needs.</summary>
        private static (float[] Positions, int[] Triangles) Cylinder(double cx, double cz, double radius, double y0, double y1, int around, int along)
        {
            var positions = new List<float>();
            var triangles = new List<int>();
            for (var j = 0; j <= along; j++)
            {
                var y = y0 + (y1 - y0) * j / along;
                for (var i = 0; i < around; i++)
                {
                    var a = 2 * Math.PI * i / around;
                    positions.Add((float)(cx + radius * Math.Cos(a)));
                    positions.Add((float)y);
                    positions.Add((float)(cz + radius * Math.Sin(a)));
                }
            }
            for (var j = 0; j < along; j++)
            {
                for (var i = 0; i < around; i++)
                {
                    int a = j * around + i, b = j * around + (i + 1) % around, c = a + around, d = b + around;
                    triangles.AddRange(new[] { a, c, b, b, c, d });
                }
            }
            foreach (var (row, y, flip) in new[] { (0, y0, true), (along, y1, false) })
            {
                var centre = positions.Count / 3;
                positions.Add((float)cx);
                positions.Add((float)y);
                positions.Add((float)cz);
                for (var i = 0; i < around; i++)
                {
                    int a = row * around + i, b = row * around + (i + 1) % around;
                    triangles.AddRange(flip ? new[] { centre, a, b } : new[] { centre, b, a });
                }
            }
            return (positions.ToArray(), triangles.ToArray());
        }

        /// <summary>A closed box, each face cut into a fine grid.</summary>
        private static (float[] Positions, int[] Triangles) Box(double x0, double y0, double z0, double x1, double y1, double z1, int cuts)
        {
            var positions = new List<float>();
            var triangles = new List<int>();
            void Face(Func<double, double, (double, double, double)> at)
            {
                var start = positions.Count / 3;
                for (var j = 0; j <= cuts; j++)
                {
                    for (var i = 0; i <= cuts; i++)
                    {
                        var (x, y, z) = at((double)i / cuts, (double)j / cuts);
                        positions.Add((float)x);
                        positions.Add((float)y);
                        positions.Add((float)z);
                    }
                }
                for (var j = 0; j < cuts; j++)
                {
                    for (var i = 0; i < cuts; i++)
                    {
                        int a = start + j * (cuts + 1) + i, b = a + 1, c = a + cuts + 1, d = c + 1;
                        triangles.AddRange(new[] { a, b, c, b, d, c });
                    }
                }
            }
            double L(double a, double b, double t) => a + (b - a) * t;
            Face((u, v) => (L(x0, x1, u), L(y0, y1, v), z0));
            Face((u, v) => (L(x1, x0, u), L(y0, y1, v), z1));
            Face((u, v) => (x0, L(y0, y1, v), L(z1, z0, u)));
            Face((u, v) => (x1, L(y0, y1, v), L(z0, z1, u)));
            Face((u, v) => (L(x0, x1, u), y0, L(z1, z0, v)));
            Face((u, v) => (L(x0, x1, u), y1, L(z0, z1, v)));
            return (positions.ToArray(), triangles.ToArray());
        }

        private static (float[] Positions, int[] Triangles) Join(params (float[] Positions, int[] Triangles)[] parts)
        {
            var positions = new List<float>();
            var triangles = new List<int>();
            foreach (var part in parts)
            {
                var offset = positions.Count / 3;
                positions.AddRange(part.Positions);
                triangles.AddRange(part.Triangles.Select(t => t + offset));
            }
            return (positions.ToArray(), triangles.ToArray());
        }

        /// <summary>
        /// The part seen from the side along <paramref name="depthAxis"/> (0 for x,
        /// 2 for z), as filled cells of a grid over the full mesh's outline, so
        /// two drawings of the same part compare cell for cell.
        /// </summary>
        private static double SilhouetteIoU(IReadOnlyList<(float[] P, int[] T)> full, IReadOnlyList<(float[] P, int[] T)> reduced, int depthAxis)
        {
            var across = depthAxis == 0 ? 2 : 0;
            double x0 = double.MaxValue, x1 = double.MinValue, y0 = double.MaxValue, y1 = double.MinValue;
            foreach (var (p, _) in full)
            {
                for (var i = 0; i < p.Length; i += 3)
                {
                    x0 = Math.Min(x0, p[i + across]);
                    x1 = Math.Max(x1, p[i + across]);
                    y0 = Math.Min(y0, p[i + 1]);
                    y1 = Math.Max(y1, p[i + 1]);
                }
            }
            var cell = Math.Max(x1 - x0, y1 - y0) / 400.0;
            x0 -= 2 * cell;
            y0 -= 2 * cell;
            var w = (int)((x1 - x0) / cell) + 4;
            var h = (int)((y1 - y0) / cell) + 4;
            var a = Fill(full, across, x0, y0, cell, w, h);
            var b = Fill(reduced, across, x0, y0, cell, w, h);
            int both = 0, either = 0;
            for (var i = 0; i < a.Length; i++)
            {
                if (a[i] && b[i]) both++;
                if (a[i] || b[i]) either++;
            }
            return either == 0 ? 1.0 : (double)both / either;
        }

        private static bool[] Fill(IReadOnlyList<(float[] P, int[] T)> meshes, int across, double x0, double y0, double cell, int w, int h)
        {
            var grid = new bool[w * h];
            foreach (var (p, t) in meshes)
            {
                for (var k = 0; k + 2 < t.Length; k += 3)
                {
                    var xs = new double[3];
                    var ys = new double[3];
                    for (var c = 0; c < 3; c++)
                    {
                        xs[c] = p[t[k + c] * 3 + across];
                        ys[c] = p[t[k + c] * 3 + 1];
                    }
                    var d = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
                    if (Math.Abs(d) < 1e-14)
                    {
                        continue;
                    }
                    var i0 = Math.Max(0, (int)((xs.Min() - x0) / cell));
                    var i1 = Math.Min(w - 1, (int)((xs.Max() - x0) / cell) + 1);
                    var j0 = Math.Max(0, (int)((ys.Min() - y0) / cell));
                    var j1 = Math.Min(h - 1, (int)((ys.Max() - y0) / cell) + 1);
                    for (var j = j0; j <= j1; j++)
                    {
                        for (var i = i0; i <= i1; i++)
                        {
                            double px = x0 + (i + 0.5) * cell, py = y0 + (j + 0.5) * cell;
                            var u = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) / d;
                            var v = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) / d;
                            if (u >= -1e-9 && v >= -1e-9 && 1 - u - v >= -1e-9)
                            {
                                grid[j * w + i] = true;
                            }
                        }
                    }
                }
            }
            return grid;
        }

        private static List<(float[] P, int[] T)> Drawn(IEnumerable<MeshReduction.Result> results) =>
            results.Select(r => (r.Positions, r.Triangles)).ToList();

        private static int LooseParts(float[] positions, int[] triangles)
        {
            var parent = Enumerable.Range(0, positions.Length / 3).ToArray();
            int Find(int x) => parent[x] == x ? x : parent[x] = Find(parent[x]);
            for (var t = 0; t < triangles.Length; t += 3)
            {
                parent[Find(triangles[t + 1])] = Find(triangles[t]);
                parent[Find(triangles[t + 2])] = Find(triangles[t]);
            }
            return triangles.Select(Find).Distinct().Count();
        }

        [Fact]
        public void APlateOverANarrowCoreKeepsTheCoreAndTheBudget()
        {
            var plate = Box(-1.0, 0.0, -1.0, 1.0, 0.1, 1.0, 24);
            var core = Cylinder(0, 0, 0.15, -1.5, -0.01, 48, 40);
            var source = new MeshReduction.Source("plate", Join(plate, core).Positions, Join(plate, core).Triangles);

            var reduced = MeshReduction.Reduce(new[] { source }, 300);

            var result = Assert.Single(reduced);
            Assert.InRange(result.Triangles.Length / 3, 1, 300);
            var full = new List<(float[], int[])> { (source.Positions, source.Triangles) };
            Assert.True(SilhouetteIoU(full, Drawn(reduced), 0) >= 0.97);
            Assert.True(SilhouetteIoU(full, Drawn(reduced), 2) >= 0.97);
            Assert.Equal(2, LooseParts(result.Positions, result.Triangles));

            /* The core's own width survives below the plate: nothing there is filled out to the plate's edge. */
            var below = Enumerable.Range(0, result.Positions.Length / 3).Where(i => result.Positions[i * 3 + 1] < -0.2f).ToList();
            Assert.NotEmpty(below);
            Assert.All(below, i => Assert.InRange(Math.Abs(result.Positions[i * 3]), 0, 0.16));
        }

        [Fact]
        public void AThinPipeBesideATankIsKeptAsItsOwnPiece()
        {
            var tank = Cylinder(0, 0, 0.6, -1.0, 1.0, 64, 60);
            var pipe = Cylinder(0.75, 0, 0.03, -0.9, 0.9, 16, 60);
            var joined = Join(tank, pipe);
            var source = new MeshReduction.Source("tank", joined.Positions, joined.Triangles);

            var reduced = MeshReduction.Reduce(new[] { source }, 400);

            var result = Assert.Single(reduced);
            Assert.InRange(result.Triangles.Length / 3, 1, 400);
            Assert.Equal(2, LooseParts(result.Positions, result.Triangles));
            var full = new List<(float[], int[])> { (source.Positions, source.Triangles) };
            Assert.True(SilhouetteIoU(full, Drawn(reduced), 2) >= 0.97);

            /* Seen across z, the pipe still has its own width and its whole length beside the tank. */
            var pipePoints = Enumerable.Range(0, result.Positions.Length / 3).Where(i => result.Positions[i * 3] > 0.7f).ToList();
            Assert.True(pipePoints.Max(i => result.Positions[i * 3]) - pipePoints.Min(i => result.Positions[i * 3]) > 0.04);
            Assert.True(pipePoints.Max(i => result.Positions[i * 3 + 1]) - pipePoints.Min(i => result.Positions[i * 3 + 1]) > 1.7);
        }

        [Fact]
        public void MeshesShareOneBudgetAndASmallOneIsKeptWhole()
        {
            var big = Cylinder(0, 0, 0.6, -1.0, 1.0, 64, 60);
            var small = Box(1, 0, 0, 1.1, 0.1, 0.1, 1);
            var sources = new[]
            {
                new MeshReduction.Source("big", big.Positions, big.Triangles),
                new MeshReduction.Source("small", small.Positions, small.Triangles),
            };

            var reduced = MeshReduction.Reduce(sources, 200);

            Assert.Equal(new[] { "big", "small" }, reduced.Select(r => r.Key));
            Assert.Equal(12, reduced[1].Triangles.Length / 3);
            Assert.InRange(reduced.Sum(r => r.Triangles.Length / 3), 1, 200);
            Assert.Equal(big.Triangles.Length / 3, reduced[0].SourceTriangles);
        }

        [Fact]
        public void AMeshWithinTheBudgetComesOutWholeWithItsSeamsJoined()
        {
            var tri = new MeshReduction.Source(
                "seam",
                new float[] { 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0 },
                new[] { 0, 1, 2, 3, 4, 5 });

            var result = Assert.Single(MeshReduction.Reduce(new[] { tri }));

            Assert.Equal(2, result.Triangles.Length / 3);
            Assert.Equal(4, result.Positions.Length / 3);
        }

        [Fact]
        public void TheSameMeshReducesTheSameWayEveryTime()
        {
            var tank = Cylinder(0, 0, 0.6, -1.0, 1.0, 64, 60);
            var source = new MeshReduction.Source("tank", tank.Positions, tank.Triangles);

            var first = Assert.Single(MeshReduction.Reduce(new[] { source }, 150));
            var second = Assert.Single(MeshReduction.Reduce(new[] { source }, 150));

            Assert.Equal(first.Positions, second.Positions);
            Assert.Equal(first.Triangles, second.Triangles);
        }
    }
}
