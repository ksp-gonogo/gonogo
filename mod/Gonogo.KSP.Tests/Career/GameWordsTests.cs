using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// A refusal quotes the game rather than composing English here, and this is
    /// where the quoting happens.
    /// </summary>
    public class GameWordsTests
    {
        /// <summary>
        /// The one that made this necessary. <c>ClearToSaveStatus</c> is the
        /// authority behind every recovery refusal and carries no
        /// <c>[Description]</c> at all, so the member name is the only thing the
        /// code can reach; its sentences live in the localisation table under
        /// opaque <c>#autoLOC_</c> numbers the enum does not reference.
        /// </summary>
        [Fact]
        public void AnUndescribedEnumBecomesItsOwnNameInLowerCase()
        {
            Assert.Equal(
                "not while throttled up", GameWords.Phrase(ClearToSaveStatus.NOT_WHILE_THROTTLED_UP));
            Assert.Equal(
                "not while about to crash", GameWords.Phrase(ClearToSaveStatus.NOT_WHILE_ABOUT_TO_CRASH));
            Assert.Equal(
                "orbit event imminent", GameWords.Phrase(ClearToSaveStatus.ORBIT_EVENT_IMMINENT));
        }

        /// <summary>
        /// The raw form keeps the game's token exactly, for anywhere the token
        /// rather than the clause is what is wanted.
        /// </summary>
        [Fact]
        public void TheRawFormDoesNotRewriteTheGamesToken()
        {
            Assert.Equal(
                "NOT_WHILE_ON_A_LADDER", GameWords.Of(ClearToSaveStatus.NOT_WHILE_ON_A_LADDER));
        }

        /// <summary>
        /// A contract enum passes through without throwing.
        ///
        /// <para>This test used to assert the opposite, and was right to: the
        /// contract's shipped build carried <c>[TsEnum]</c> from
        /// Reinforced.Typings, an assembly deliberately never deployed, and
        /// reading a member's attributes resolves every attribute on it, so this
        /// threw <c>FileNotFoundException</c> — out of <c>member.ToString()</c>,
        /// upstream of the try/catch meant to absorb it. Asking for
        /// <c>DescriptionAttribute</c> specifically did not filter it out.</para>
        ///
        /// <para>The attributes now exist only in Sitrep.Contract.Codegen, so
        /// the throw is gone. Kept, inverted, because a test that pins a bug in
        /// place is worth exactly as much as one that pins the fix.</para>
        /// </summary>
        [Fact]
        public void AContractEnumPassesThroughWithoutThrowing()
        {
            Assert.Equal("antinormal", GameWords.Phrase(SasMode.Antinormal));
            Assert.Equal("Antinormal", GameWords.Of(SasMode.Antinormal));
        }

        [Fact]
        public void ANullMemberLosesTheClauseAndNotTheRefusal()
        {
            Assert.Equal("", GameWords.Of(null!));
            Assert.Equal("", GameWords.Phrase(null!));
        }
    }
}
