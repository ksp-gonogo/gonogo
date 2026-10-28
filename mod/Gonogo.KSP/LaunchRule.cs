using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// The two launch refusals KSP never makes itself, because its own Launch
    /// button is never pressed on a craft it could not open.
    ///
    /// <para><b>A craft that does not resolve is placed anyway.</b>
    /// <c>ShipTemplate.LoadShip</c> does not throw on a part this install lacks,
    /// nor on a part tree it cannot root: it logs "Could not locate root part"
    /// and returns a template with a null <c>rootPartNode</c>. Nothing between
    /// that and <c>FlightDriver.StartWithNewLaunch</c> asks again, so the
    /// launch proceeds into a flight scene that cannot build the vessel. Stock
    /// never reaches this, because the editor refuses to load such a craft
    /// before its Launch button exists.</para>
    ///
    /// <para><b>A save that throws is this call's refusal, not the command's
    /// end.</b> <c>StartWithNewLaunch</c> writes <c>persistent.sfs</c> before it
    /// loads the flight scene, and a scenario module that throws while saving
    /// (a <c>ReflectionTypeLoadException</c> on the rig) unwinds out of it. An
    /// exception leaving a handler takes the whole command down for the
    /// session, which is right for a bug in the handler and wrong here: the
    /// throw is the game's, it happened before the scene changed, and the next
    /// press may well succeed.</para>
    ///
    /// <para>Carved out of its caller so it carries no KSP type and a headless
    /// test can enter it, the same discipline as <see cref="SceneExitRule"/>.
    /// The caller keeps the live reads: which parts <c>PartLoader</c> knows, the
    /// template's root, and the call into the game.</para>
    /// </summary>
    internal static class LaunchRule
    {
        /// <summary>How many missing part names a refusal quotes before it summarises the rest.</summary>
        internal const int NamedMissingParts = 5;

        /// <summary>
        /// Why the craft cannot be placed, or null when every part resolves and
        /// the tree has a root. Missing parts are reported ahead of the root,
        /// because a part the install lacks is the usual reason a root cannot be
        /// found, and the part names are what the operator can act on.
        /// </summary>
        /// <param name="missingParts">Part names in the craft that this install's <c>PartLoader</c> does not know.</param>
        /// <param name="rootLocated">Whether <c>ShipTemplate.LoadShip</c> found a root part.</param>
        public static CommandResult? UnresolvedCraft(IEnumerable<string>? missingParts, bool rootLocated)
        {
            var missing = (missingParts ?? Enumerable.Empty<string>())
                .Where(name => !string.IsNullOrEmpty(name))
                .Distinct(StringComparer.Ordinal)
                .ToList();

            if (missing.Count > 0)
            {
                var named = string.Join(", ", missing.Take(NamedMissingParts));
                var rest = missing.Count - NamedMissingParts;
                if (rest > 0)
                {
                    named += " and " + rest + " more";
                }
                return CommandResult.Fail(
                    CommandErrorCode.CapabilityMismatch,
                    "the craft uses parts this install does not have: " + named);
            }

            if (!rootLocated)
            {
                return CommandResult.Fail(
                    CommandErrorCode.CapabilityMismatch,
                    "KSP could not locate the craft's root part");
            }

            return null;
        }

        /// <summary>
        /// The reason a craft with no control source cannot launch, when the
        /// game's sentence would name the wrong cause, or null to quote the
        /// game's. KSP says "no remote-controlled or manned command modules"
        /// whether or not the craft has a cockpit, so a crewed craft with nobody
        /// seated in it is told what is actually missing: an empty crew list
        /// launches the craft unmanned, it does not pick a default crew.
        /// </summary>
        /// <param name="hasCrewedCommandModule">Whether any command module on the craft needs a kerbal aboard.</param>
        /// <param name="crewNamed">How many kerbals the launch named in its crew list.</param>
        /// <param name="unavailableCrew">The named kerbals the launch could not seat, each as <see cref="UnavailableKerbal"/> words, or null when none.</param>
        public static string? NoControlSourceDetail(
            bool hasCrewedCommandModule, int crewNamed, IReadOnlyList<string>? unavailableCrew = null)
        {
            if (!hasCrewedCommandModule)
            {
                return null;
            }
            if (crewNamed == 0)
            {
                return "the craft's command module needs a kerbal and the crew list is empty, which launches it unmanned";
            }
            const string unfilled = "the kerbals named in the crew list do not fill the craft's command module";
            return unavailableCrew == null || unavailableCrew.Count == 0
                ? unfilled
                : unfilled + ": " + string.Join(", ", unavailableCrew) + " could not be seated";
        }

        /// <summary>
        /// One named kerbal the launch could not seat, in the words a refusal
        /// quotes: the name and the roster status that kept them out
        /// ("Jebediah Kerman (Assigned)"), or "not on the roster" when the
        /// roster has no kerbal of that name.
        /// </summary>
        /// <param name="name">The name the crew list gave.</param>
        /// <param name="rosterStatus">The kerbal's roster status, or null when the roster has no such kerbal.</param>
        public static string UnavailableKerbal(string name, string? rosterStatus)
        {
            return rosterStatus == null
                ? name + " (not on the roster)"
                : name + " (" + rosterStatus + ")";
        }

        /// <summary>
        /// The refusal for a craft whose real cost, modules included, is more than the funds on
        /// hand, or null when it is affordable or either figure is unknown (no funds outside career).
        /// Stock's own affordability test prices the craft from its file, which leaves out the
        /// cost modules add, while the rollout charge includes them.
        /// </summary>
        public static CommandResult? Unaffordable(double? costWithModules, double? funds)
        {
            if (costWithModules == null || funds == null || costWithModules.Value <= funds.Value + 0.005)
            {
                return null;
            }

            return CommandResult.Fail(
                CommandErrorCode.InsufficientFunds,
                "the craft costs "
                + costWithModules.Value.ToString("N0", System.Globalization.CultureInfo.InvariantCulture)
                + " funds with its modules and "
                + funds.Value.ToString("N0", System.Globalization.CultureInfo.InvariantCulture)
                + " are available");
        }

        /// <summary>
        /// Place the craft, answering a throw from the game with a refusal of
        /// this call instead of letting it end the command.
        /// </summary>
        /// <param name="startWithNewLaunch"><c>FlightDriver.StartWithNewLaunch</c>, which saves and then loads the flight scene.</param>
        public static CommandResult Place(Action startWithNewLaunch)
        {
            try
            {
                startWithNewLaunch();
            }
            catch (Exception ex)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "KSP could not save the game before launching: " + Message(ex));
            }
            return CommandResult.Ok();
        }

        /// <summary>
        /// The exception's own words. <c>Message</c> is a virtual getter that can
        /// itself throw, and a throw here would escape the refusal it is part of.
        /// </summary>
        private static string Message(Exception ex)
        {
            try
            {
                return ex.Message;
            }
            catch (Exception)
            {
                return ex.GetType().Name;
            }
        }
    }
}
