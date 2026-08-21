using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// A refusal a rule reached, before anything decides which
    /// <see cref="CommandResult"/> shape carries it.
    ///
    /// <para>Not a <c>CommandResult</c>, deliberately. Some commands answer
    /// <c>CommandResult&lt;T&gt;</c>, which is a subclass, so a rule that built
    /// the base type could not be used by them at all: the payload-carrying
    /// commands would need their own copy of every rule. The code and the
    /// sentence are what a rule actually decides; which envelope they go home in
    /// is the caller's.</para>
    /// </summary>
    internal readonly struct Refusal
    {
        public Refusal(CommandErrorCode code, string detail)
        {
            Code = code;
            Detail = detail;
        }

        public CommandErrorCode Code { get; }

        /// <summary>The game's own words, when the rule had any. Empty is legal: the code is the load-bearing half.</summary>
        public string Detail { get; }
    }
}
