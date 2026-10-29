using System.Collections.Generic;
using Gonogo.KSP;
using UnityEngine;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class MeshPiecesTests
    {
        private sealed class Renderer
        {
        }

        private sealed class Mesh
        {
            public Mesh(Vector3[] vertices)
            {
                Vertices = vertices;
            }

            public Vector3[] Vertices { get; }

            public Bounds Bounds
            {
                get
                {
                    var b = new Bounds(Vertices[0], Vector3.zero);
                    foreach (var v in Vertices)
                    {
                        b.Encapsulate(v);
                    }
                    return b;
                }
            }
        }

        /// <summary>A turn about an axis, written out so no engine call is needed.</summary>
        private static Quaternion About(Vector3 axis, float degrees)
        {
            var half = degrees * Mathf.Deg2Rad / 2f;
            var sin = Mathf.Sin(half);
            return new Quaternion(axis.x * sin, axis.y * sin, axis.z * sin, Mathf.Cos(half));
        }

        private static readonly Mesh Tank = new Mesh(new[]
        {
            new Vector3(-0.6f, -1f, -0.6f), new Vector3(0.6f, -1f, 0.6f), new Vector3(0.6f, 1f, -0.6f),
            new Vector3(-0.6f, 1f, 0.6f), new Vector3(0f, 1.2f, 0f), new Vector3(0.3f, -1.1f, 0.1f),
        });

        private static readonly Mesh Leg = new Mesh(new[]
        {
            new Vector3(0f, 0f, 0f), new Vector3(0.1f, -0.9f, 0.05f), new Vector3(-0.1f, -0.9f, -0.05f), new Vector3(0f, -1f, 0.2f),
        });

        private static readonly (Vector3, Quaternion, Vector3)[] TankChain =
        {
            (new Vector3(0f, 0.25f, 0f), About(Vector3.up, 30f), new Vector3(1.25f, 1.25f, 1.25f)),
        };

        private static (Vector3, Quaternion, Vector3)[] LegChain(float deployDegrees) => new[]
        {
            (new Vector3(0f, -0.2f, 0f), About(Vector3.right, deployDegrees), Vector3.one),
            (new Vector3(0.7f, -0.8f, 0f), About(Vector3.forward, 10f), Vector3.one),
        };

        private static MeshPiece Fresh(Mesh mesh, Matrix4x4 toPart) =>
            MeshPiece.Measure(mesh.Vertices, mesh.Bounds, toPart);

        private static MeshPiece Reused(MeshPieceMemo<Renderer> memo, Renderer renderer, Mesh mesh, Matrix4x4 toPart) =>
            memo.Piece(renderer, mesh, toPart, () => Fresh(mesh, toPart));

        private static void AssertSamePart(IReadOnlyList<MeshPiece> expected, IReadOnlyList<MeshPiece> actual)
        {
            Assert.Equal(
                PartBox.TryAssemble(expected, out var eCenter, out var eSize, out var ePath),
                PartBox.TryAssemble(actual, out var aCenter, out var aSize, out var aPath));
            Assert.Equal(eCenter, aCenter);
            Assert.Equal(eSize, aSize);
            Assert.Equal(ePath, aPath);
        }

        [Fact]
        public void APartFlyingThroughTheWorldReusesItsPiecesAndMeasuresAsAFreshPass()
        {
            var memo = new MeshPieceMemo<Renderer>();
            var tank = new Renderer();
            var leg = new Renderer();

            // The carry is built from the local transforms alone, so where the vessel is does not enter it.
            for (var sample = 0; sample < 5; sample++)
            {
                var tankToPart = PartBox.ToPart(TankChain);
                var legToPart = PartBox.ToPart(LegChain(0f));
                AssertSamePart(
                    new[] { Fresh(Tank, tankToPart), Fresh(Leg, legToPart) },
                    new[] { Reused(memo, tank, Tank, tankToPart), Reused(memo, leg, Leg, legToPart) });
            }

            Assert.Equal(2, memo.Measured);
        }

        [Fact]
        public void AMeshThatMovesInsideItsPartIsMeasuredAgain()
        {
            var memo = new MeshPieceMemo<Renderer>();
            var tank = new Renderer();
            var leg = new Renderer();
            var tankToPart = PartBox.ToPart(TankChain);
            Reused(memo, tank, Tank, tankToPart);
            Reused(memo, leg, Leg, PartBox.ToPart(LegChain(0f)));

            var deployed = PartBox.ToPart(LegChain(80f));
            AssertSamePart(
                new[] { Fresh(Tank, tankToPart), Fresh(Leg, deployed) },
                new[] { Reused(memo, tank, Tank, tankToPart), Reused(memo, leg, Leg, deployed) });
            Assert.Equal(3, memo.Measured);
        }

        [Fact]
        public void ARendererGivenAnotherMeshIsMeasuredAgain()
        {
            var memo = new MeshPieceMemo<Renderer>();
            var renderer = new Renderer();
            var toPart = PartBox.ToPart(TankChain);
            Reused(memo, renderer, Tank, toPart);

            var swapped = Reused(memo, renderer, Leg, toPart);

            Assert.Equal(Fresh(Leg, toPart).Hi, swapped.Hi);
            Assert.Equal(2, memo.Measured);
        }

        [Fact]
        public void TheCarryToThePartIsEachLocalTransformInTurnFromTheMeshUp()
        {
            var chain = LegChain(35f);
            var point = new Vector3(0.1f, -0.9f, 0.05f);

            var expected = point;
            foreach (var (position, rotation, scale) in chain)
            {
                expected = rotation * Vector3.Scale(scale, expected) + position;
            }
            var carried = PartBox.ToPart(chain).MultiplyPoint3x4(point);

            Assert.Equal(expected.x, carried.x, 5);
            Assert.Equal(expected.y, carried.y, 5);
            Assert.Equal(expected.z, carried.z, 5);
        }
    }
}
