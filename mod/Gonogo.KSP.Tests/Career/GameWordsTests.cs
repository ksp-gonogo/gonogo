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
        /// The restriction in the doc comment, made executable: a CONTRACT enum
        /// must not go through here.
        ///
        /// <para>Reading a member's attributes forces the runtime to resolve
        /// every attribute on it, and the contract's netstandard build carries
        /// <c>[TsEnum]</c> from Reinforced.Typings, which is deliberately absent
        /// at runtime. Asking for <c>DescriptionAttribute</c> does not filter
        /// that out. The shipped net472 contract has no such attribute, so the
        /// call would have looked fine in game: this pins the reason it is not
        /// there, since the next person to move a type between those builds would
        /// otherwise find out the hard way.</para>
        /// </summary>
        [Fact]
        public void AContractEnumsAttributesCannotBeReadHere()
        {
            Assert.ThrowsAny<System.Exception>(() => GameWords.Phrase(SasMode.Antinormal));
        }

        [Fact]
        public void ANullMemberLosesTheClauseAndNotTheRefusal()
        {
            Assert.Equal("", GameWords.Of(null!));
            Assert.Equal("", GameWords.Phrase(null!));
        }
    }
}
