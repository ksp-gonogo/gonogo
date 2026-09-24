using System;
using System.Linq;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// <see cref="RosterControlSource.For"/> against the REAL
    /// <c>Vessel.ControlLevel</c> out of <c>Assembly-CSharp.dll</c>. Its default
    /// arm has to exist for a newer KSP at runtime, so a level added to the enum
    /// would compile silently into it; this is where that addition fails instead.
    /// </summary>
    public class RosterControlSourceTests
    {
        [Fact]
        public void NamesEveryLevelTheGameDeclares()
        {
            var unnamed = Enum.GetValues(typeof(Vessel.ControlLevel))
                .Cast<Vessel.ControlLevel>()
                .Where(level => RosterControlSource.For(level) == RosterControlSource.Unknown)
                .ToList();
            Assert.Empty(unnamed);
        }

        [Fact]
        public void ReportsNoControlAsNoneAndNotUnknown()
        {
            Assert.Equal("None", RosterControlSource.For(Vessel.ControlLevel.NONE));
        }

        [Fact]
        public void ReportsALevelItCannotNameAsUnknownAndNotNone()
        {
            var unnamed = (Vessel.ControlLevel)(Enum.GetValues(typeof(Vessel.ControlLevel))
                .Cast<int>()
                .Max() + 1);
            Assert.Equal(RosterControlSource.Unknown, RosterControlSource.For(unnamed));
        }
    }
}
