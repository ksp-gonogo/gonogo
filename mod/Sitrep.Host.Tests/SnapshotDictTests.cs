using System.Collections.Generic;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Unit tests for <see cref="SnapshotDict"/>'s scalar readers -- focused
    /// on Fix E: <see cref="SnapshotDict.GetInt"/> lacked the same
    /// non-finite-is-absent guard <see cref="SnapshotDict.GetDouble"/> and
    /// <see cref="SnapshotDict.GetVec3"/> already apply (R1/F-1, see the
    /// class doc comment). Before the fix, a boxed <c>double</c> value of
    /// <c>NaN</c> cast straight to <c>int</c> (via the unchecked
    /// <c>(int)d</c> conversion) silently produced <c>0</c>, and
    /// <c>+Infinity</c> produced <c>int.MaxValue</c> -- both fabricated
    /// values, reachable in practice via a replay decode of a literal
    /// <c>"NaN"</c>/<c>"Infinity"</c> string landing in an integral field
    /// (e.g. a malformed/hand-edited recording, or a future integral field
    /// fed from a computed double). This regression is only reachable
    /// through the <c>double</c>/<c>float</c> branches -- <c>int</c>/
    /// <c>long</c> sources are always finite by construction.
    /// </summary>
    public class SnapshotDictTests
    {
        [Fact]
        public void GetIntTreatsANaNDoubleAsAbsentNeverZero()
        {
            var raw = new Dictionary<string, object?> { ["value"] = double.NaN };

            Assert.Null(SnapshotDict.GetInt(raw, "value"));
        }

        [Fact]
        public void GetIntTreatsPositiveInfinityAsAbsentNeverIntMaxValue()
        {
            var raw = new Dictionary<string, object?> { ["value"] = double.PositiveInfinity };

            Assert.Null(SnapshotDict.GetInt(raw, "value"));
        }

        [Fact]
        public void GetIntTreatsNegativeInfinityAsAbsentNeverIntMinValue()
        {
            var raw = new Dictionary<string, object?> { ["value"] = double.NegativeInfinity };

            Assert.Null(SnapshotDict.GetInt(raw, "value"));
        }

        [Fact]
        public void GetIntTreatsANaNFloatAsAbsentToo()
        {
            var raw = new Dictionary<string, object?> { ["value"] = float.NaN };

            Assert.Null(SnapshotDict.GetInt(raw, "value"));
        }

        [Fact]
        public void GetIntStillParsesARealFiniteDoubleUnaffectedByTheGuard()
        {
            var raw = new Dictionary<string, object?> { ["value"] = 42.0 };

            Assert.Equal(42, SnapshotDict.GetInt(raw, "value"));
        }

        [Fact]
        public void GetIntStillParsesARealIntUnaffectedByTheGuard()
        {
            var raw = new Dictionary<string, object?> { ["value"] = 7 };

            Assert.Equal(7, SnapshotDict.GetInt(raw, "value"));
        }

        [Fact]
        public void GetIntReturnsNullWhenKeyIsAbsentOrExplicitlyNull()
        {
            var raw = new Dictionary<string, object?> { ["present"] = (object?)null };

            Assert.Null(SnapshotDict.GetInt(raw, "missing"));
            Assert.Null(SnapshotDict.GetInt(raw, "present"));
        }

        [Fact]
        public void GetDoubleReadsALivePartFlightIdBoxedAsUint()
        {
            // KspHost stores Part.flightID as it comes, a uint.
            var raw = new Dictionary<string, object?> { ["partId"] = 4_000_000_000u };

            Assert.Equal(4_000_000_000.0, SnapshotDict.GetDouble(raw, "partId"));
            Assert.Equal(4_000_000_000u, (uint?)SnapshotDict.GetDouble(raw, "partId"));
        }

        [Fact]
        public void GetDoubleReadsABoxedUlong()
        {
            var raw = new Dictionary<string, object?> { ["value"] = 12UL };

            Assert.Equal(12.0, SnapshotDict.GetDouble(raw, "value"));
        }

        [Fact]
        public void GetIntReadsABoxedUintThatFits()
        {
            var raw = new Dictionary<string, object?> { ["value"] = 7u };

            Assert.Equal(7, SnapshotDict.GetInt(raw, "value"));
        }

        [Fact]
        public void GetIntTreatsABoxedUintPastIntAsAbsentRatherThanWrapping()
        {
            var raw = new Dictionary<string, object?> { ["value"] = 4_000_000_000u };

            Assert.Null(SnapshotDict.GetInt(raw, "value"));
        }
    }
}
