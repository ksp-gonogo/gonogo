using Gonogo.KSP;
using UnityEngine;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class BoundsPathReportTests
    {
        private static Matrix4x4 TurnedAboutX90()
        {
            var m = Matrix4x4.identity;
            m.m11 = 0f; m.m12 = -1f;
            m.m21 = 1f; m.m22 = 0f;
            return m;
        }

        // The stock tail fin's two meshes in the frame of its Base transform, which is turned 90 degrees about X
        private static readonly Vector3[] FinBase =
        {
            new Vector3(-0.119f, -0.073f, -1.344f), new Vector3(0.206f, 0.073f, 1.039f),
        };

        private static readonly Vector3[] FinSurface =
        {
            new Vector3(0.206f, -0.066f, -1.063f), new Vector3(1.871f, 0.066f, 1.231f),
        };

        [Fact]
        public void TheStockTailFinMeasuresToItsPublishedSizeFromVerticesAndFromBoundsAlike()
        {
            var lo = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var hi = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            var turn = TurnedAboutX90();
            var first = MeshExtent.Grow(FinBase, new Bounds(), turn, ref lo, ref hi);
            var second = MeshExtent.Grow(FinSurface, new Bounds(), turn, ref lo, ref hi);

            Assert.Equal(MeasurePath.Vertices, first);
            Assert.Equal(MeasurePath.Vertices, second);
            var size = hi - lo;
            Assert.InRange(size.x, 1.98f, 2.0f);
            Assert.InRange(size.y, 2.57f, 2.58f);
            Assert.InRange(size.z, 0.14f, 0.15f);
        }

        [Fact]
        public void AMeshWithoutVerticesIsMeasuredFromItsBoundsAndSaysSo()
        {
            var lo = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var hi = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            var used = MeshExtent.Grow(null, new Bounds(Vector3.zero, new Vector3(2f, 1f, 0.2f)), Matrix4x4.identity, ref lo, ref hi);

            Assert.Equal(MeasurePath.MeshBounds, used);
            Assert.Equal(2f, (hi - lo).x, 3);
        }

        [Fact]
        public void TheLineCountsEachPathAndNamesTheFallbacks()
        {
            var report = new BoundsPathReport();
            report.Add("tailfin", MeasurePath.Vertices);
            report.Add("winglet3", MeasurePath.MeshBounds);
            report.Add("winglet3", MeasurePath.MeshBounds);
            report.Add("strut", MeasurePath.None);

            Assert.Equal(
                "bounds paths for \"Seahawk\": vertices 1, meshBounds 2, mixed 0, none 1 (not from vertices: winglet3)",
                report.Line("Seahawk"));
        }
    }
}
