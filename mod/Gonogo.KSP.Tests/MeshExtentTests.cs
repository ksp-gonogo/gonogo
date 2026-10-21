using Gonogo.KSP;
using UnityEngine;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class MeshExtentTests
    {
        /// <summary>A rotation about Z by 45 degrees, written out so no engine call is needed.</summary>
        private static Matrix4x4 TurnedAboutZ()
        {
            var c = (float)System.Math.Cos(System.Math.PI / 4);
            var s = (float)System.Math.Sin(System.Math.PI / 4);
            var m = Matrix4x4.identity;
            m.m00 = c; m.m01 = -s;
            m.m10 = s; m.m11 = c;
            return m;
        }

        // A thin flat fin lying along X, 2 m by 0.1 m, which is also its bounds
        private static readonly Vector3[] Fin =
        {
            new Vector3(-1f, -0.05f, 0f), new Vector3(1f, -0.05f, 0f),
            new Vector3(-1f, 0.05f, 0f), new Vector3(1f, 0.05f, 0f),
        };

        [Fact]
        public void AMeshTurnedAgainstItsPartMeasuresToItsVerticesNotItsRotatedBounds()
        {
            var lo = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var hi = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            MeshExtent.GrowOverPoints(Fin, TurnedAboutZ(), ref lo, ref hi);
            var fromVertices = hi - lo;

            // The 45 degree turn of a 2 x 0.1 slab spans (2 + 0.1) / sqrt 2 on X and Y
            Assert.Equal(2.1f / System.MathF.Sqrt(2f), fromVertices.x, 3);
            Assert.Equal(2.1f / System.MathF.Sqrt(2f), fromVertices.y, 3);
        }

        [Fact]
        public void ATriangleTurnedAgainstItsPartIsTighterThanItsTurnedBounds()
        {
            // A triangle: its bounds are the full 2 x 2 square, its vertices are not
            var triangle = new[] { new Vector3(-1f, -1f, 0f), new Vector3(1f, -1f, 0f), new Vector3(-1f, 1f, 0f) };
            var lo = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var hi = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            MeshExtent.GrowOverPoints(triangle, TurnedAboutZ(), ref lo, ref hi);

            var cLo = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var cHi = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            MeshExtent.GrowOverCorners(new Bounds(Vector3.zero, new Vector3(2f, 2f, 0f)), TurnedAboutZ(), ref cLo, ref cHi);

            Assert.Equal(2f * System.MathF.Sqrt(2f), (cHi - cLo).y, 3);
            Assert.Equal(System.MathF.Sqrt(2f), (hi - lo).y, 3);
        }
    }
}
