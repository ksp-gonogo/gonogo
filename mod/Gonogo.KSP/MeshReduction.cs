using System;
using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Brings a part's meshes down to a triangle budget by quadric edge
    /// collapse, keeping each mesh, and each loose part inside a mesh, as its
    /// own surface. Nothing is welded across meshes and no hull is taken, so a
    /// narrow core under a wide plate, or a thin pipe beside a tank, keeps its
    /// own outline from every side.
    ///
    /// <para>Pure arithmetic over plain arrays, so it runs off the main thread
    /// and carries no game or engine type.</para>
    /// </summary>
    internal static class MeshReduction
    {
        /// <summary>The triangle budget for one part over all of its meshes.</summary>
        public const int DefaultBudget = 1200;

        /// <summary>No mesh is brought below this many triangles, or below what it has when that is fewer.</summary>
        public const int MinShare = 12;

        /*
         * A loose part is never collapsed below this many triangles, so a small
         * closed piece ends as a solid with a body rather than vanishing or
         * flattening into a sheet that has no width from the side.
         */
        private const int MinLoosePart = 4;

        /*
         * A boundary edge's guard plane weighs this many times its length
         * squared, so an open edge holds its place in the outline against
         * collapses inside the surface.
         */
        private const double BoundaryWeight = 100.0;

        /* A collapse that turns any surviving face further than this from its old facing (as a cosine) is refused. */
        private const double MinFacingCosine = 0.2;

        /// <summary>One mesh as it stands in its part.</summary>
        internal sealed class Source
        {
            public Source(string key, float[] positions, int[] triangles)
            {
                Key = key;
                Positions = positions;
                Triangles = triangles;
            }

            /// <summary>The mesh's stable name within its part.</summary>
            public string Key { get; }

            /// <summary>Vertex positions in the part's own frame (metres), as x, y, z triples.</summary>
            public float[] Positions { get; }

            /// <summary>Three vertex indices per triangle.</summary>
            public int[] Triangles { get; }
        }

        /// <summary>One mesh after reduction, in the part's own frame.</summary>
        internal sealed class Result
        {
            public Result(string key, float[] positions, int[] triangles, int sourceTriangles)
            {
                Key = key;
                Positions = positions;
                Triangles = triangles;
                SourceTriangles = sourceTriangles;
            }

            public string Key { get; }

            /// <summary>The kept vertices, as x, y, z triples in the part's own frame, each one an original vertex.</summary>
            public float[] Positions { get; }

            /// <summary>Three indices into <see cref="Positions"/> per triangle.</summary>
            public int[] Triangles { get; }

            /// <summary>How many triangles the mesh had before reduction.</summary>
            public int SourceTriangles { get; }
        }

        /// <summary>
        /// Every source reduced so their triangles together come to at most
        /// <paramref name="budget"/>. The meshes are reduced together, cheapest
        /// collapse first across all of them, so the triangles go wherever the
        /// shape needs them most rather than to whichever mesh had the most. A
        /// mesh is never brought below <see cref="MinShare"/>, so a part with very
        /// many meshes can come out over the budget. A mesh with no triangles
        /// comes out empty.
        /// </summary>
        public static List<Result> Reduce(IReadOnlyList<Source> sources, int budget = DefaultBudget)
        {
            var welded = new List<Welded>(sources.Count);
            var total = 0;
            foreach (var source in sources)
            {
                var w = Weld(source);
                welded.Add(w);
                total += w.FaceCount;
            }

            var results = new List<Result>(sources.Count);
            if (total <= budget)
            {
                for (var i = 0; i < welded.Count; i++)
                {
                    results.Add(welded[i].ToResult(sources[i].Key, 0, welded[i].FaceCount, null));
                }
                return results;
            }

            var all = Combine(welded, out var meshOfVertex, out var firstFace);
            var collapser = new Collapser(all, meshOfVertex, welded);
            collapser.Run(budget);
            for (var i = 0; i < welded.Count; i++)
            {
                results.Add(all.ToResult(sources[i].Key, firstFace[i], welded[i].FaceCount, collapser.Dead, welded[i].SourceTriangles));
            }
            return results;
        }

        /* Every mesh in one vertex and face list, no vertex shared between two meshes, each mesh's faces in one run. */
        private static Welded Combine(List<Welded> meshes, out int[] meshOfVertex, out int[] firstFace)
        {
            var positions = new List<float>();
            var faces = new List<int>();
            var owner = new List<int>();
            firstFace = new int[meshes.Count];
            for (var m = 0; m < meshes.Count; m++)
            {
                var offset = positions.Count / 3;
                firstFace[m] = faces.Count / 3;
                positions.AddRange(meshes[m].Positions);
                for (var i = 0; i < meshes[m].Positions.Length / 3; i++)
                {
                    owner.Add(m);
                }
                foreach (var v in meshes[m].Faces)
                {
                    faces.Add(v + offset);
                }
            }
            meshOfVertex = owner.ToArray();
            return new Welded { Positions = positions.ToArray(), Faces = faces.ToArray() };
        }

        /// <summary>A mesh with its vertices joined wherever two share a position, the form collapse works on.</summary>
        internal sealed class Welded
        {
            public float[] Positions = Array.Empty<float>();
            public int[] Faces = Array.Empty<int>();
            public int FaceCount => Faces.Length / 3;
            public int SourceTriangles;

            /// <summary>The faces from <paramref name="first"/> on, <paramref name="count"/> of them, less any dead, with only the vertices they use.</summary>
            public Result ToResult(string key, int first, int count, bool[]? deadFaces, int? sourceTriangles = null)
            {
                var remap = new Dictionary<int, int>();
                var faces = new List<int>(count * 3);
                var positions = new List<float>();
                for (var f = first; f < first + count; f++)
                {
                    if (deadFaces != null && deadFaces[f])
                    {
                        continue;
                    }
                    for (var c = 0; c < 3; c++)
                    {
                        var v = Faces[f * 3 + c];
                        if (!remap.TryGetValue(v, out var at))
                        {
                            at = positions.Count / 3;
                            remap[v] = at;
                            positions.Add(Positions[v * 3]);
                            positions.Add(Positions[v * 3 + 1]);
                            positions.Add(Positions[v * 3 + 2]);
                        }
                        faces.Add(at);
                    }
                }
                return new Result(key, positions.ToArray(), faces.ToArray(), sourceTriangles ?? SourceTriangles);
            }
        }

        /// <summary>
        /// Joins vertices at exactly the same position (a mesh repeats a vertex
        /// at every texture or normal seam) and drops triangles that fold to a line.
        /// Vertices that only lie close are left apart, so pieces that merely
        /// touch stay separate.
        /// </summary>
        internal static Welded Weld(Source source)
        {
            var positions = source.Positions;
            var count = positions.Length / 3;
            var index = new Dictionary<(float, float, float), int>();
            var map = new int[count];
            var welded = new List<float>();
            for (var i = 0; i < count; i++)
            {
                var key = (positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
                if (!index.TryGetValue(key, out var at))
                {
                    at = welded.Count / 3;
                    index[key] = at;
                    welded.Add(key.Item1);
                    welded.Add(key.Item2);
                    welded.Add(key.Item3);
                }
                map[i] = at;
            }

            var faces = new List<int>(source.Triangles.Length);
            var tris = source.Triangles;
            for (var t = 0; t + 2 < tris.Length; t += 3)
            {
                if (tris[t] < 0 || tris[t] >= count || tris[t + 1] < 0 || tris[t + 1] >= count || tris[t + 2] < 0 || tris[t + 2] >= count)
                {
                    continue;
                }
                int a = map[tris[t]], b = map[tris[t + 1]], c = map[tris[t + 2]];
                if (a == b || b == c || a == c)
                {
                    continue;
                }
                faces.Add(a);
                faces.Add(b);
                faces.Add(c);
            }

            return new Welded
            {
                Positions = welded.ToArray(),
                Faces = faces.ToArray(),
                SourceTriangles = tris.Length / 3,
            };
        }

        /// <summary>
        /// Garland and Heckbert's quadric error collapse, restricted to moving
        /// one end of an edge onto the other so every kept vertex is an original
        /// one. Errors are in the part's frame, in metres squared.
        /// </summary>
        private sealed class Collapser
        {
            private readonly Welded _mesh;
            private readonly double[] _p;
            private readonly double[][] _q;
            private readonly List<int>[] _vf;
            private readonly int[] _version;
            private readonly bool[] _gone;
            private readonly bool[] _boundary;
            private readonly int[] _component;
            private readonly int[] _componentFaces;
            private readonly int[] _componentFloor;
            private readonly int[] _meshOfVertex;
            private readonly int[] _meshFaces;
            private readonly int[] _meshFloor;
            private readonly Heap _heap = new Heap();
            private int _live;

            public bool[] Dead { get; }

            public Collapser(Welded mesh, int[] meshOfVertex, IReadOnlyList<Welded> meshes)
            {
                _mesh = mesh;
                _meshOfVertex = meshOfVertex;
                _meshFaces = new int[meshes.Count];
                _meshFloor = new int[meshes.Count];
                for (var m = 0; m < meshes.Count; m++)
                {
                    _meshFaces[m] = meshes[m].FaceCount;
                    _meshFloor[m] = Math.Min(meshes[m].FaceCount, MinShare);
                }
                var n = mesh.Positions.Length / 3;
                _p = new double[n * 3];
                for (var i = 0; i < _p.Length; i++)
                {
                    _p[i] = mesh.Positions[i];
                }

                _q = new double[n][];
                _vf = new List<int>[n];
                for (var i = 0; i < n; i++)
                {
                    _q[i] = new double[10];
                    _vf[i] = new List<int>(6);
                }
                _version = new int[n];
                _gone = new bool[n];
                _boundary = new bool[n];
                Dead = new bool[mesh.FaceCount];
                _live = mesh.FaceCount;

                var faces = mesh.Faces;
                var edgeFaces = new Dictionary<long, int>();
                for (var f = 0; f < mesh.FaceCount; f++)
                {
                    int a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
                    _vf[a].Add(f);
                    _vf[b].Add(f);
                    _vf[c].Add(f);
                    if (Plane(a, b, c, out var nx, out var ny, out var nz, out var area))
                    {
                        var d = -(nx * _p[a * 3] + ny * _p[a * 3 + 1] + nz * _p[a * 3 + 2]);
                        AddPlane(a, nx, ny, nz, d, area);
                        AddPlane(b, nx, ny, nz, d, area);
                        AddPlane(c, nx, ny, nz, d, area);
                    }
                    Count(edgeFaces, a, b);
                    Count(edgeFaces, b, c);
                    Count(edgeFaces, c, a);
                }

                for (var f = 0; f < mesh.FaceCount; f++)
                {
                    for (var e = 0; e < 3; e++)
                    {
                        int a = faces[f * 3 + e], b = faces[f * 3 + (e + 1) % 3], c = faces[f * 3 + (e + 2) % 3];
                        if (edgeFaces[EdgeKey(a, b)] == 1)
                        {
                            _boundary[a] = true;
                            _boundary[b] = true;
                            GuardBoundary(a, b, c);
                        }
                    }
                }

                _component = Components(n, faces, mesh.FaceCount, out var componentCount);
                _componentFaces = new int[componentCount];
                for (var f = 0; f < mesh.FaceCount; f++)
                {
                    _componentFaces[_component[faces[f * 3]]]++;
                }
                _componentFloor = new int[componentCount];
                for (var c = 0; c < componentCount; c++)
                {
                    _componentFloor[c] = Math.Min(_componentFaces[c], MinLoosePart);
                }

                foreach (var key in edgeFaces.Keys)
                {
                    Push((int)(key >> 32), (int)(key & 0xffffffff));
                }
            }

            public void Run(int target)
            {
                while (_live > target && _heap.TryPop(out var entry))
                {
                    if (_gone[entry.From] || _gone[entry.To]
                        || _version[entry.From] != entry.FromVersion || _version[entry.To] != entry.ToVersion)
                    {
                        continue;
                    }
                    if (CanCollapse(entry.From, entry.To))
                    {
                        Apply(entry.From, entry.To);
                    }
                }
            }

            private static void Count(Dictionary<long, int> edges, int a, int b)
            {
                var key = EdgeKey(a, b);
                edges.TryGetValue(key, out var count);
                edges[key] = count + 1;
            }

            private static long EdgeKey(int a, int b) => a < b ? ((long)a << 32) | (uint)b : ((long)b << 32) | (uint)a;

            private static int[] Components(int n, int[] faces, int faceCount, out int count)
            {
                var parent = new int[n];
                for (var i = 0; i < n; i++)
                {
                    parent[i] = i;
                }
                int Find(int x)
                {
                    while (parent[x] != x)
                    {
                        parent[x] = parent[parent[x]];
                        x = parent[x];
                    }
                    return x;
                }
                for (var f = 0; f < faceCount; f++)
                {
                    var r = Find(faces[f * 3]);
                    parent[Find(faces[f * 3 + 1])] = r;
                    parent[Find(faces[f * 3 + 2])] = Find(faces[f * 3]);
                }
                var ids = new Dictionary<int, int>();
                var component = new int[n];
                for (var i = 0; i < n; i++)
                {
                    var root = Find(i);
                    if (!ids.TryGetValue(root, out var id))
                    {
                        id = ids.Count;
                        ids[root] = id;
                    }
                    component[i] = id;
                }
                count = ids.Count;
                return component;
            }

            private bool Plane(int a, int b, int c, out double nx, out double ny, out double nz, out double area)
            {
                Normal(_p[a * 3], _p[a * 3 + 1], _p[a * 3 + 2], _p[b * 3], _p[b * 3 + 1], _p[b * 3 + 2], _p[c * 3], _p[c * 3 + 1], _p[c * 3 + 2], out nx, out ny, out nz);
                var len = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                area = len * 0.5;
                if (len <= 0)
                {
                    return false;
                }
                nx /= len;
                ny /= len;
                nz /= len;
                return true;
            }

            private static void Normal(double ax, double ay, double az, double bx, double by, double bz, double cx, double cy, double cz, out double nx, out double ny, out double nz)
            {
                double ux = bx - ax, uy = by - ay, uz = bz - az;
                double vx = cx - ax, vy = cy - ay, vz = cz - az;
                nx = uy * vz - uz * vy;
                ny = uz * vx - ux * vz;
                nz = ux * vy - uy * vx;
            }

            private void AddPlane(int v, double a, double b, double c, double d, double w)
            {
                var q = _q[v];
                q[0] += w * a * a;
                q[1] += w * a * b;
                q[2] += w * a * c;
                q[3] += w * a * d;
                q[4] += w * b * b;
                q[5] += w * b * c;
                q[6] += w * b * d;
                q[7] += w * c * c;
                q[8] += w * c * d;
                q[9] += w * d * d;
            }

            /* A plane through the boundary edge a-b standing square to its face, so moving off the edge costs. */
            private void GuardBoundary(int a, int b, int c)
            {
                if (!Plane(a, b, c, out var fx, out var fy, out var fz, out _))
                {
                    return;
                }
                double ex = _p[b * 3] - _p[a * 3], ey = _p[b * 3 + 1] - _p[a * 3 + 1], ez = _p[b * 3 + 2] - _p[a * 3 + 2];
                var length2 = ex * ex + ey * ey + ez * ez;
                double nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
                var len = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                if (len <= 0)
                {
                    return;
                }
                nx /= len;
                ny /= len;
                nz /= len;
                var d = -(nx * _p[a * 3] + ny * _p[a * 3 + 1] + nz * _p[a * 3 + 2]);
                AddPlane(a, nx, ny, nz, d, BoundaryWeight * length2);
                AddPlane(b, nx, ny, nz, d, BoundaryWeight * length2);
            }

            private double Error(int a, int b, int at)
            {
                var qa = _q[a];
                var qb = _q[b];
                double x = _p[at * 3], y = _p[at * 3 + 1], z = _p[at * 3 + 2];
                double q0 = qa[0] + qb[0], q1 = qa[1] + qb[1], q2 = qa[2] + qb[2], q3 = qa[3] + qb[3];
                double q4 = qa[4] + qb[4], q5 = qa[5] + qb[5], q6 = qa[6] + qb[6];
                double q7 = qa[7] + qb[7], q8 = qa[8] + qb[8], q9 = qa[9] + qb[9];
                return q0 * x * x + 2 * q1 * x * y + 2 * q2 * x * z + 2 * q3 * x
                    + q4 * y * y + 2 * q5 * y * z + 2 * q6 * y
                    + q7 * z * z + 2 * q8 * z + q9;
            }

            private void Push(int a, int b)
            {
                /* A boundary vertex moves only along the boundary, never inward onto an inner vertex. */
                var aToB = !_boundary[a] || _boundary[b] ? Error(a, b, b) : double.PositiveInfinity;
                var bToA = !_boundary[b] || _boundary[a] ? Error(a, b, a) : double.PositiveInfinity;
                if (double.IsPositiveInfinity(aToB) && double.IsPositiveInfinity(bToA))
                {
                    return;
                }
                if (aToB <= bToA)
                {
                    _heap.Push(new Heap.Entry(aToB, a, b, _version[a], _version[b]));
                }
                else
                {
                    _heap.Push(new Heap.Entry(bToA, b, a, _version[b], _version[a]));
                }
            }

            private bool CanCollapse(int from, int to)
            {
                var faces = _mesh.Faces;
                var shared = 0;
                foreach (var f in _vf[from])
                {
                    if (faces[f * 3] == to || faces[f * 3 + 1] == to || faces[f * 3 + 2] == to)
                    {
                        shared++;
                    }
                }
                if (shared == 0)
                {
                    return false;
                }

                var component = _component[from];
                var owner = _meshOfVertex[from];
                if (_componentFaces[component] - shared < _componentFloor[component] || _meshFaces[owner] - shared < _meshFloor[owner])
                {
                    return false;
                }

                /* The link condition: the two ends may share no neighbour beyond the faces on the edge itself, or the surface would pinch. */
                var fromNeighbours = Neighbours(from);
                var toNeighbours = Neighbours(to);
                var common = 0;
                foreach (var v in fromNeighbours)
                {
                    if (v != to && toNeighbours.Contains(v))
                    {
                        common++;
                    }
                }
                if (common != shared)
                {
                    return false;
                }

                foreach (var f in _vf[from])
                {
                    int a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
                    if (a == to || b == to || c == to)
                    {
                        continue;
                    }
                    Normal(_p[a * 3], _p[a * 3 + 1], _p[a * 3 + 2], _p[b * 3], _p[b * 3 + 1], _p[b * 3 + 2], _p[c * 3], _p[c * 3 + 1], _p[c * 3 + 2], out var ox, out var oy, out var oz);
                    if (a == from) a = to;
                    if (b == from) b = to;
                    if (c == from) c = to;
                    Normal(_p[a * 3], _p[a * 3 + 1], _p[a * 3 + 2], _p[b * 3], _p[b * 3 + 1], _p[b * 3 + 2], _p[c * 3], _p[c * 3 + 1], _p[c * 3 + 2], out var nx, out var ny, out var nz);
                    var oldLen = Math.Sqrt(ox * ox + oy * oy + oz * oz);
                    var newLen = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                    if (newLen <= 1e-12 * Math.Max(1.0, oldLen))
                    {
                        return false;
                    }
                    if (oldLen > 0 && ox * nx + oy * ny + oz * nz < MinFacingCosine * oldLen * newLen)
                    {
                        return false;
                    }
                }
                return true;
            }

            private HashSet<int> Neighbours(int v)
            {
                var set = new HashSet<int>();
                var faces = _mesh.Faces;
                foreach (var f in _vf[v])
                {
                    for (var c = 0; c < 3; c++)
                    {
                        var u = faces[f * 3 + c];
                        if (u != v)
                        {
                            set.Add(u);
                        }
                    }
                }
                return set;
            }

            private void Apply(int from, int to)
            {
                var faces = _mesh.Faces;
                var component = _component[from];
                var owner = _meshOfVertex[from];
                foreach (var f in _vf[from])
                {
                    int a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
                    if (a == to || b == to || c == to)
                    {
                        Dead[f] = true;
                        _live--;
                        _componentFaces[component]--;
                        _meshFaces[owner]--;
                        for (var k = 0; k < 3; k++)
                        {
                            var u = faces[f * 3 + k];
                            if (u != from)
                            {
                                _vf[u].Remove(f);
                            }
                        }
                        continue;
                    }
                    for (var k = 0; k < 3; k++)
                    {
                        if (faces[f * 3 + k] == from)
                        {
                            faces[f * 3 + k] = to;
                        }
                    }
                    _vf[to].Add(f);
                }
                _vf[from].Clear();
                _gone[from] = true;

                var qf = _q[from];
                var qt = _q[to];
                for (var i = 0; i < 10; i++)
                {
                    qt[i] += qf[i];
                }
                _version[to]++;
                foreach (var u in Neighbours(to))
                {
                    Push(to, u);
                }
            }
        }

        /// <summary>A binary min-heap of candidate collapses by error.</summary>
        private sealed class Heap
        {
            internal readonly struct Entry
            {
                public Entry(double cost, int from, int to, int fromVersion, int toVersion)
                {
                    Cost = cost;
                    From = from;
                    To = to;
                    FromVersion = fromVersion;
                    ToVersion = toVersion;
                }

                public double Cost { get; }
                public int From { get; }
                public int To { get; }
                public int FromVersion { get; }
                public int ToVersion { get; }
            }

            private readonly List<Entry> _items = new List<Entry>();

            public void Push(Entry entry)
            {
                _items.Add(entry);
                var i = _items.Count - 1;
                while (i > 0)
                {
                    var parent = (i - 1) / 2;
                    if (Before(_items[parent], _items[i]))
                    {
                        break;
                    }
                    (_items[parent], _items[i]) = (_items[i], _items[parent]);
                    i = parent;
                }
            }

            public bool TryPop(out Entry entry)
            {
                if (_items.Count == 0)
                {
                    entry = default;
                    return false;
                }
                entry = _items[0];
                var last = _items[_items.Count - 1];
                _items.RemoveAt(_items.Count - 1);
                if (_items.Count == 0)
                {
                    return true;
                }
                _items[0] = last;
                var i = 0;
                while (true)
                {
                    int l = i * 2 + 1, r = l + 1, best = i;
                    if (l < _items.Count && Before(_items[l], _items[best]))
                    {
                        best = l;
                    }
                    if (r < _items.Count && Before(_items[r], _items[best]))
                    {
                        best = r;
                    }
                    if (best == i)
                    {
                        break;
                    }
                    (_items[best], _items[i]) = (_items[i], _items[best]);
                    i = best;
                }
                return true;
            }

            /* Ties fall to the lower vertex pair, so a run is the same on every machine. */
            private static bool Before(Entry a, Entry b)
            {
                if (a.Cost != b.Cost)
                {
                    return a.Cost < b.Cost;
                }
                if (a.From != b.From)
                {
                    return a.From < b.From;
                }
                return a.To < b.To;
            }
        }
    }
}
