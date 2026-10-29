using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>parts.shape.&lt;key&gt;</c> dynamic namespace: each kind of part's
    /// meshes, read once from its prefab, reduced to <see cref="MeshReduction.DefaultBudget"/>
    /// triangles and published while something subscribes to its key. A key is
    /// read the first time it is asked for and kept for the rest of the game, so
    /// a later subscriber is sent the kept shape and nothing is read again.
    ///
    /// <para>The meshes are read on the main thread a few at a time, at most
    /// <see cref="VerticesPerSample"/> vertices a sample, so a craft of many
    /// new kinds of part does not stall a frame; the reduction runs on a worker
    /// thread, and the shape is published once it is done.</para>
    ///
    /// <para><b>Not an Uplink discovered by attribute scan, deliberately.</b> It
    /// ships inside <c>Gonogo.dll</c> and is registered directly by
    /// <see cref="GonogoAddon"/>, the way <see cref="CraftFileChannels"/> is.</para>
    /// </summary>
    public sealed class PartShapeChannels : ISitrepUplink
    {
        /*
         * Shapes travel as topics rather than as files because Gonogo has no
         * file to serve them from. The mod's only listener is the stream's
         * WebSocket; the app's one file path is the Uplink bundle conduit, where
         * the main screen fetches a hosted URL and relays the bytes to stations
         * over PeerJS, and a file hosted with the app cannot hold the parts of
         * the player's own install and mods. Serving them from the mod would
         * mean a second listener and port, and a station could still only reach
         * it through the main screen. As topics they ride the path every station
         * already has: one send per kind of part per connection, however many
         * parts of that kind any craft holds, and a station joining late is sent
         * the kept shape as the topic's keyframe.
         */

        /// <summary>The most mesh vertices read on the main thread in one sample.</summary>
        internal const int VerticesPerSample = 40000;

        private static readonly PerfBudget ShapeReadBudget = new PerfBudget(
            "PartShapeChannels part shapes read", threshold: 20, windowSec: 1.0, unit: "shapes");

        private IDynamicChannelSource? _source;

        /* Keys asked for, from the subscribe callback on the Courier thread to the capture on the main thread. */
        private readonly ConcurrentQueue<string> _asked = new ConcurrentQueue<string>();

        /* Main thread only, from here down. */
        private readonly Dictionary<string, Dictionary<string, object?>?> _done = new Dictionary<string, Dictionary<string, object?>?>(StringComparer.Ordinal);
        private readonly Dictionary<string, Task<Dictionary<string, object?>?>> _reducing = new Dictionary<string, Task<Dictionary<string, object?>?>>(StringComparer.Ordinal);
        private readonly Queue<ShapeRead> _reads = new Queue<ShapeRead>();
        private readonly HashSet<string> _reading = new HashSet<string>(StringComparer.Ordinal);

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "partShapes",
            Bundled = true,
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>(),
        };

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            _source = host.RegisterDynamicNamespace(PartShapeWire.Prefix, new ChannelDeclaration
            {
                Kind = SampleKind.Discrete,
                Requires = Requirement.None,
                Delivery = Delivery.LossyLatest,
                /* A part's model is the same in the editor, on the pad and across the solar system, so no command centre waits for it. */
                Delay = DelayRole.TrueNow,
                Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
            });
            _source.OnSubscribed(topic => _asked.Enqueue(topic.Substring(PartShapeWire.Prefix.Length)));
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, PartShapeWire.Prefix);
        }

        /// <summary>MAIN-THREAD: starts reading each newly asked key, reads on, and hands over every shape that is ready to send.</summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var ut = snapshot != null ? snapshot.Ut : 0.0;
            var ready = new List<ShapeCapture>();
            while (_asked.TryDequeue(out var key))
            {
                if (_done.TryGetValue(key, out var kept))
                {
                    if (kept != null)
                    {
                        ready.Add(new ShapeCapture(key, kept));
                    }
                    continue;
                }
                if (_reducing.ContainsKey(key) || _reading.Contains(key))
                {
                    continue;
                }

                var read = Start(key);
                if (read == null)
                {
                    _done[key] = null;
                    GonogoLog.Info("parts", "no part shape for \"" + key + "\": no loaded part of that name");
                    continue;
                }
                _reads.Enqueue(read);
                _reading.Add(key);
            }

            var vertices = VerticesPerSample;
            while (vertices > 0 && _reads.Count > 0)
            {
                var read = _reads.Peek();
                vertices -= read.Advance(vertices);
                if (!read.Complete)
                {
                    break;
                }
                _reads.Dequeue();
                _reading.Remove(read.Key);
                ShapeReadBudget.Record(1, ut);
                _reducing[read.Key] = Task.Run(read.Reduce);
            }

            List<string>? finished = null;
            foreach (var pair in _reducing)
            {
                if (pair.Value.IsCompleted)
                {
                    (finished ??= new List<string>()).Add(pair.Key);
                }
            }
            if (finished != null)
            {
                foreach (var key in finished)
                {
                    var task = _reducing[key];
                    _reducing.Remove(key);
                    if (task.Status != TaskStatus.RanToCompletion)
                    {
                        GonogoLog.WarnLimited("part shape for \"" + key + "\" could not be reduced, omitting", task.Exception?.GetBaseException());
                        _done[key] = null;
                        continue;
                    }
                    _done[key] = task.Result;
                    if (task.Result != null)
                    {
                        ready.Add(new ShapeCapture(key, task.Result));
                    }
                }
            }

            return ready.Count == 0 ? null : new ShapesCapture(ut, ready);
        }

        /// <summary>COURIER-THREAD: publish each ready shape on its own topic.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not ShapesCapture capture || _source == null)
            {
                return;
            }

            foreach (var shape in capture.Shapes)
            {
                _source.Publisher(shape.Key).Publish(shape.Wire, capture.Ut);
            }
        }

        private static ShapeRead? Start(string key)
        {
            if (!PartShapeWire.TryParseKey(key, out var name, out var variant))
            {
                return null;
            }

            var info = PartLoader.getPartInfoByName(name);
            var prefab = info?.partPrefab;
            if (prefab == null)
            {
                return null;
            }

            return new ShapeRead(key, name, variant, PartMeshBounds.Meshes(prefab, PartShapePoses.VariantFor(prefab, variant)));
        }

        /// <summary>One kind of part's meshes, read a few at a time on the main thread and then reduced on a worker.</summary>
        private sealed class ShapeRead
        {
            private readonly List<PartMesh> _meshes;
            private readonly List<MeshCopy> _copies = new List<MeshCopy>();
            private int _next;

            public ShapeRead(string key, string name, string? variant, List<PartMesh> meshes)
            {
                Key = key;
                Name = name;
                Variant = variant;
                _meshes = meshes;
            }

            public string Key { get; }

            public string Name { get; }

            public string? Variant { get; }

            public bool Complete => _next >= _meshes.Count;

            /// <summary>Copies meshes out of the game until <paramref name="allowance"/> vertices are spent, at least one; returns how many were.</summary>
            public int Advance(int allowance)
            {
                var spent = 0;
                while (_next < _meshes.Count && (spent == 0 || spent < allowance))
                {
                    var mesh = _meshes[_next++];
                    var copy = Copy(mesh);
                    spent += Math.Max(1, copy.Vertices.Length / 3);
                    _copies.Add(copy);
                }
                return spent;
            }

            /// <summary>WORKER-THREAD: the copied meshes in the part's frame, reduced and packed into the shape's wire form.</summary>
            public Dictionary<string, object?>? Reduce()
            {
                var sources = new List<MeshReduction.Source>(_copies.Count);
                foreach (var copy in _copies)
                {
                    sources.Add(new MeshReduction.Source(copy.Key, Carry(copy.Vertices, copy.ToPart), copy.Triangles));
                }

                var reduced = MeshReduction.Reduce(sources);
                var meshes = new List<PartShapeWire.Mesh>(reduced.Count);
                for (var i = 0; i < reduced.Count; i++)
                {
                    var r = reduced[i];
                    meshes.Add(new PartShapeWire.Mesh(r.Key, _copies[i].Shown, r.Positions, r.Triangles, r.SourceTriangles));
                }
                return PartShapeWire.ToWire(PartShapeWire.Build(Name, Variant, meshes));
            }

            private static MeshCopy Copy(PartMesh mesh)
            {
                var m = mesh.ToPart;
                var toPart = new[] { m.m00, m.m01, m.m02, m.m03, m.m10, m.m11, m.m12, m.m13, m.m20, m.m21, m.m22, m.m23 };
                var vertices = PartMeshBounds.VerticesOf(mesh.Mesh);
                if (vertices == null)
                {
                    return BoxOf(mesh, toPart);
                }

                var flat = new float[vertices.Length * 3];
                for (var i = 0; i < vertices.Length; i++)
                {
                    flat[i * 3] = vertices[i].x;
                    flat[i * 3 + 1] = vertices[i].y;
                    flat[i * 3 + 2] = vertices[i].z;
                }
                return new MeshCopy(mesh.Key, mesh.Shown, flat, mesh.Mesh.triangles, toPart);
            }

            /* A mesh whose vertices cannot be read is drawn as its bounds, a closed box of twelve triangles. */
            private static MeshCopy BoxOf(PartMesh mesh, float[] toPart)
            {
                var b = mesh.Mesh.bounds;
                var lo = b.min;
                var hi = b.max;
                var corners = new float[24];
                for (var i = 0; i < 8; i++)
                {
                    corners[i * 3] = (i & 1) == 0 ? lo.x : hi.x;
                    corners[i * 3 + 1] = (i & 2) == 0 ? lo.y : hi.y;
                    corners[i * 3 + 2] = (i & 4) == 0 ? lo.z : hi.z;
                }
                var faces = new[]
                {
                    0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4,
                    2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5,
                };
                return new MeshCopy(mesh.Key, mesh.Shown, corners, faces, toPart);
            }

            private static float[] Carry(float[] vertices, float[] m)
            {
                var carried = new float[vertices.Length];
                for (var i = 0; i + 2 < vertices.Length; i += 3)
                {
                    float x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
                    carried[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
                    carried[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
                    carried[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
                }
                return carried;
            }
        }

        private sealed class MeshCopy
        {
            public MeshCopy(string key, bool shown, float[] vertices, int[] triangles, float[] toPart)
            {
                Key = key;
                Shown = shown;
                Vertices = vertices;
                Triangles = triangles;
                ToPart = toPart;
            }

            public string Key { get; }

            public bool Shown { get; }

            /// <summary>The mesh's own vertices, as x, y, z triples in its own frame.</summary>
            public float[] Vertices { get; }

            public int[] Triangles { get; }

            /// <summary>The 3 by 4 carry into the part's frame, row by row.</summary>
            public float[] ToPart { get; }
        }

        private sealed class ShapeCapture
        {
            public ShapeCapture(string key, Dictionary<string, object?> wire)
            {
                Key = key;
                Wire = wire;
            }

            public string Key { get; }

            public Dictionary<string, object?> Wire { get; }
        }

        private sealed class ShapesCapture
        {
            public ShapesCapture(double ut, List<ShapeCapture> shapes)
            {
                Ut = ut;
                Shapes = shapes;
            }

            public double Ut { get; }

            public List<ShapeCapture> Shapes { get; }
        }
    }
}
