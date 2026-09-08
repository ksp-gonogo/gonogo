using Gonogo.MechJebUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoMechJebUplink.Tests
{
    /// <summary>
    /// The inbound half of the absence sweep. <c>mechjeb.engageAscentAutopilot</c>
    /// takes one number and MechJeb flies to it, so an altitude a client could
    /// not read has to be refused here rather than written into
    /// <c>DesiredOrbitAltitude</c>: see <c>MechJebAscentGuard</c>'s doc comment
    /// for the four ways a blank input arrives as a zero.
    /// </summary>
    public class MechJebAscentGuardTests
    {
        [Fact]
        public void Refuse_RealAltitude_Passes()
        {
            Assert.Null(MechJebAscentGuard.Refuse(new MechJebAscentArgs { TargetAltitudeKm = 100.0 }));
        }

        [Fact]
        public void Refuse_Zero_IsRefusedRatherThanFlown()
        {
            // What a cleared number input sends: Number("") is 0, and an absent
            // or null wire key deserialises to 0 as well. Flying it means an
            // ascent to a 0 km orbit.
            var refusal = MechJebAscentGuard.Refuse(new MechJebAscentArgs { TargetAltitudeKm = 0.0 });

            Assert.NotNull(refusal);
            Assert.False(refusal!.Success);
            Assert.Equal(CommandErrorCode.Range, refusal.ErrorCode);
            Assert.Contains("0 km", refusal.Detail);
        }

        [Fact]
        public void Refuse_NaN_IsRefused()
        {
            // Number("abc") is NaN client-side; it reaches the wire as null and
            // lands back here as 0, but a client that sends the NaN itself must
            // not slip past either. !(x > 0) is false for NaN, which is why the
            // guard is spelled that way round.
            var refusal = MechJebAscentGuard.Refuse(new MechJebAscentArgs { TargetAltitudeKm = double.NaN });

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.Range, refusal!.ErrorCode);
        }

        [Fact]
        public void Refuse_Negative_IsRefused()
        {
            var refusal = MechJebAscentGuard.Refuse(new MechJebAscentArgs { TargetAltitudeKm = -50.0 });

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.Range, refusal!.ErrorCode);
        }

        [Fact]
        public void Refuse_NullArgs_IsRefused()
        {
            var refusal = MechJebAscentGuard.Refuse(null);

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.Range, refusal!.ErrorCode);
        }
    }
}
