using System;

namespace Gonogo.KSP
{
    /// <summary>
    /// What the GAME calls a thing, for the sentence an operator reads on a
    /// refusal.
    ///
    /// <para>Nothing here composes English. KSP's own enums carry
    /// <c>[Description("#autoLOC_…")]</c> attributes and KSP's own
    /// <c>Localizer</c> resolves them, so a refusal quotes the game in the
    /// player's language instead of this mod keeping a table of KSP's vocabulary
    /// that goes stale on every update and is wrong everywhere but English.</para>
    /// </summary>
    internal static class GameWords
    {
        /// <summary>
        /// A state enum member as the game writes it: <c>Assigned</c>,
        /// <c>Offered</c>, <c>NOT_WHILE_THROTTLED_UP</c>.
        ///
        /// <para><c>displayDescription()</c> is <c>Description()</c> put through
        /// <c>Localizer</c>. A member with no <c>[Description]</c> falls back to
        /// its own name, which is still the game's word for it, and a Localizer
        /// that is not up yet is caught rather than being allowed to lose the
        /// refusal it was only decorating.</para>
        /// </summary>
        public static string Of(Enum member)
        {
            if (member == null) return "";
            try
            {
                return member.displayDescription() ?? member.ToString();
            }
            catch (Exception)
            {
                return member.ToString();
            }
        }
    }
}
