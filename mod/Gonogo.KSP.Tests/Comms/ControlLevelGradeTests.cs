using System;
using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// <see cref="ControlLevelGrade"/> against the REAL <c>Vessel.ControlLevel</c>
    /// out of <c>Assembly-CSharp.dll</c>. Its default arm has to exist for a newer
    /// KSP at runtime, so a level added to the enum would compile silently into
    /// it; this is where that addition fails instead.
    /// </summary>
    public class ControlLevelGradeTests
    {
        [Fact]
        public void NamesEveryLevelTheGameDeclares()
        {
            var unnamed = Enum.GetValues(typeof(Vessel.ControlLevel))
                .Cast<Vessel.ControlLevel>()
                .Where(level => ControlLevelGrade.Of(level) == CommsControlGrade.Unknown)
                .ToList();
            Assert.Empty(unnamed);
        }

        [Fact]
        public void ReportsNoControlAsNoneAndNotUnknown()
        {
            Assert.Equal(CommsControlGrade.None, ControlLevelGrade.Of(Vessel.ControlLevel.NONE));
            Assert.Equal(CommsControlSource.None, ControlLevelGrade.SourceOf(Vessel.ControlLevel.NONE));
        }

        [Fact]
        public void ReportsALevelItCannotNameAsUnknownAndNotNone()
        {
            var unnamed = (Vessel.ControlLevel)(Enum.GetValues(typeof(Vessel.ControlLevel))
                .Cast<int>()
                .Max() + 1);
            Assert.Equal(CommsControlGrade.Unknown, ControlLevelGrade.Of(unnamed));
            Assert.Equal(CommsControlSource.Unknown, ControlLevelGrade.SourceOf(unnamed));
        }
    }
}
