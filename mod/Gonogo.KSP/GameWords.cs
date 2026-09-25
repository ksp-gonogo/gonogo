using System;
using Gonogo.KSP.Gates;
using KSP.Localization;

namespace Gonogo.KSP
{
    /// <summary>
    /// What the GAME calls one of its own enum members, craft or launch sites,
    /// for the words an operator reads.
    ///
    /// <para>Nothing here composes English. Many of KSP's state enums carry
    /// <c>[Description("#autoLOC_...")]</c> and KSP's own <c>Localizer</c> resolves
    /// them, so a refusal quotes the game in the player's language instead of
    /// this mod keeping a table of KSP's vocabulary that goes stale on every
    /// update and is wrong everywhere but English.</para>
    ///
    /// <para><b>The enum half is meant for KSP's enums.</b> A <c>Sitrep.Contract</c> enum gains
    /// nothing here: its members carry no <c>[Description]</c>, its name is
    /// already ours to write, and this would only lower-case it.</para>
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
        /// matters here: its five reachable arms are the reason a recovery is
        /// refused, and their sentences live only in the localisation table under opaque
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
                return Resolved(
                    args == null || args.Length == 0 ? Localizer.Format(key) : Localizer.Format(key, args),
                    fallback);
            }
            catch (Exception)
            {
                return fallback;
            }
        }

        /// <summary>
        /// A name the game stores as either a localisation tag or plain text, as
        /// the player sees it in game. A stock craft is named
        /// <c>#autoLOC_8006417</c> in its save and a player's own craft by what
        /// they typed; <c>Localizer.Format</c> resolves the first and passes the
        /// second through, which is all <c>Vessel.GetDisplayName</c> does.
        ///
        /// <para>Checked the same way as <see cref="Sentence"/>, because the
        /// Localizer fails silently in both directions: empty when it is not up,
        /// the tag itself when its table has no entry. Either way the answer is
        /// <paramref name="fallback"/>.</para>
        /// </summary>
        public static string Name(string stored, string fallback)
        {
            try
            {
                return Resolved(Localizer.Format(stored), fallback);
            }
            catch (Exception)
            {
                return fallback;
            }
        }

        /// <summary>
        /// A craft's name as the player sees it in game, for anything that names
        /// it to an operator. A craft with no name at all is <c>Vessel</c>.
        /// </summary>
        public static string VesselName(Vessel vessel) =>
            string.IsNullOrEmpty(vessel.vesselName) ? "Vessel" : Name(vessel.vesselName, vessel.vesselName);

        /// <summary>
        /// A launch site as the player sees it in game, by the id a launch names
        /// it with, or the id itself when the game has no readable name for it.
        ///
        /// <para>The KSC pad and runway are asked by their facility, because
        /// <c>PSystemSetup.GetLaunchSiteDisplayName</c> answers those from the
        /// facility's own display-name field, which holds the bare id: it returns
        /// <c>LaunchPad</c>, never <c>Launch Pad</c>. The game's own label for a
        /// facility is <c>ScenarioUpgradeableFacilities.GetFacilityName</c>, the
        /// one its space-centre screens show. Every other site is asked through
        /// <c>GetLaunchSiteDisplayName</c>, which resolves a <c>LaunchSite</c>'s
        /// name properly.</para>
        /// </summary>
        public static string LaunchSiteName(string siteId)
        {
            try
            {
                return Resolved(
                    FacilityGateHelp.TryParseFacility(siteId, out var facility)
                        ? FacilityGateHelp.DisplayName(facility)
                        : PSystemSetup.Instance?.GetLaunchSiteDisplayName(siteId),
                    siteId);
            }
            catch (Exception)
            {
                return siteId;
            }
        }

        /// <summary>
        /// A string KSP has already put through <c>Localizer</c>, or
        /// <paramref name="fallback"/> when that produced nothing a player could
        /// read: blank, or a tag that did not resolve.
        /// </summary>
        public static string Resolved(string? formatted, string fallback) =>
            string.IsNullOrWhiteSpace(formatted) ||
            formatted!.IndexOf("#autoLOC", StringComparison.OrdinalIgnoreCase) >= 0
                ? fallback
                : formatted;
    }
}
