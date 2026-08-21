using System;
using KSP.Localization;

namespace Gonogo.KSP
{
    /// <summary>
    /// What the GAME calls one of its own enum members, for the sentence an
    /// operator reads on a refusal.
    ///
    /// <para>Nothing here composes English. Many of KSP's state enums carry
    /// <c>[Description("#autoLOC_…")]</c> and KSP's own <c>Localizer</c> resolves
    /// them, so a refusal quotes the game in the player's language instead of
    /// this mod keeping a table of KSP's vocabulary that goes stale on every
    /// update and is wrong everywhere but English.</para>
    ///
    /// <para><b>Meant for KSP's enums.</b> A <c>Sitrep.Contract</c> enum gains
    /// nothing here: its members carry no <c>[Description]</c>, its name is
    /// already ours to write, and this would only lower-case it.</para>
    ///
    /// <para>It used to be far worse than pointless. The contract's shipped
    /// build carried <c>[TsEnum]</c> from Reinforced.Typings, an assembly
    /// deliberately never deployed, and reading a member's attributes resolves
    /// EVERY attribute on it, so passing a contract enum threw
    /// <c>FileNotFoundException</c>, from <c>member.ToString()</c>, before the
    /// try below could catch anything. Those attributes now exist only in
    /// Sitrep.Contract.Codegen, so it is a style point again rather than a
    /// trap.</para>
    /// </summary>
    internal static class GameWords
    {
        /// <summary>
        /// A state enum member as the game writes it: <c>Assigned</c>,
        /// <c>Offered</c>, <c>NOT_WHILE_THROTTLED_UP</c>.
        ///
        /// <para><c>displayDescription()</c> is KSP's <c>Description()</c> put
        /// through <c>Localizer</c>. A member with no <c>[Description]</c> falls
        /// back to its own name, which is still the game's word for it. A
        /// Localizer that is not up returns an empty string rather than throwing,
        /// which is why empty is treated as absent here: an empty clause on a
        /// refusal reads as a sentence that came back blank.</para>
        /// </summary>
        public static string Of(Enum member)
        {
            if (member == null) return "";
            var name = member.ToString();
            try
            {
                var described = member.displayDescription();
                return string.IsNullOrWhiteSpace(described) ? name : described;
            }
            catch (Exception)
            {
                // Losing the description loses part of a sentence. Losing the
                // refusal it was decorating would be the real damage.
                return name;
            }
        }

        /// <summary>
        /// The same word, as a clause an operator reads:
        /// <c>NOT_WHILE_THROTTLED_UP</c> becomes <c>not while throttled up</c>.
        ///
        /// <para>Some of KSP's most useful refusal enums carry no
        /// <c>[Description]</c> at all. <c>ClearToSaveStatus</c> is the one that
        /// matters here: its seven arms are the reason a recovery is refused, and
        /// their sentences live only in the localisation table under opaque
        /// <c>#autoLOC_</c> numbers the enum does not reference. Formatting one of
        /// those numbers by hand would put a confidently wrong sentence in front
        /// of an operator the first time KSP renumbers them.</para>
        ///
        /// <para>So the member NAME is the source, mechanically de-underscored
        /// and lower-cased. That is a rendering of the game's own token, not a
        /// table of our own words for its states.</para>
        /// </summary>
        public static string Phrase(Enum member)
        {
            if (member == null) return "";
            var word = Of(member);
            if (string.IsNullOrEmpty(word)) return "";
            // A description came back if it differs from the member name; leave
            // that alone, it is already prose and already localised.
            if (word != member.ToString()) return word;
            return word.Replace('_', ' ').ToLowerInvariant();
        }

        /// <summary>
        /// One of KSP's own refusal sentences by its localisation key, or
        /// <paramref name="fallback"/> when the Localizer had nothing for it.
        ///
        /// <para>Naming an <c>#autoLOC_</c> number by hand is the risk
        /// <see cref="Phrase"/>'s own comment names: KSP renumbers them, and a
        /// key that no longer resolves comes back as the key itself, which in
        /// front of an operator is worse than a plain sentence. So the result is
        /// CHECKED, and the fallback is what a caller supplies for the case the
        /// check catches. Use this only where the sentence exists nowhere but
        /// the table (a <c>void</c> method that posts a
        /// <c>ScreenMessage</c>), never where the game hands one back.</para>
        /// </summary>
        public static string Sentence(string key, string fallback, params object[] args)
        {
            try
            {
                var formatted = args == null || args.Length == 0
                    ? Localizer.Format(key)
                    : Localizer.Format(key, args);
                if (string.IsNullOrWhiteSpace(formatted) ||
                    formatted.IndexOf("#autoLOC", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return fallback;
                }
                return formatted;
            }
            catch (Exception)
            {
                return fallback;
            }
        }
    }
}
