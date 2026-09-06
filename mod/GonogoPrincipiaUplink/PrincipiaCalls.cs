using System;
using System.Collections.Generic;
using System.Text;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The register of which Principia plugin-interface calls this assembly may
    /// bind, which it must never bind, and why, enforced at runtime rather than
    /// left to review.
    ///
    /// <para>This is <see cref="ReflectedMembers"/>'s argument applied one layer
    /// down. There the danger was that a fatal managed getter looks exactly like
    /// a harmless field read; here it is worse, because every call on this surface
    /// looks like every other call and a handful of them end in
    /// <c>abort()</c>. <c>FlightPlanNumberOfManoeuvres</c> and
    /// <c>FlightPlanRenderedApsides</c> are the same shape, take the same
    /// arguments and read the same plan. One is safe behind two predicates; the
    /// other aborts the player's game on the plotting frame they happen to have
    /// selected, three frames below the call. A reviewer reading the diff has
    /// nothing to notice, so the refusal has to be a check rather than a
    /// convention.</para>
    ///
    /// <para>The checks run in refusal order, not allowlist order. An exactly
    /// named refusal wins over <see cref="Allowed"/>, so a name mistakenly added
    /// to the allowlist still fails: a guard whose allowlist can override its own
    /// refusals cannot see its own failure.</para>
    /// </summary>
    public static class PrincipiaCalls
    {
        /// <summary>
        /// Every <c>Interface</c> member this assembly may bind, each cleared in
        /// the per-call safety analysis of the exact installed revision.
        ///
        /// <para>Being on this list is not permission to call the thing anywhere.
        /// It is permission for <see cref="IPrincipiaPlugin"/> to name it, and the
        /// preconditions that make it safe are carried by the gate types in
        /// <c>PrincipiaFrame.cs</c>, which are the only route to any of these.</para>
        ///
        /// <para>Grouped by the precondition each needs: no handle at all;
        /// a live plugin handle; a live handle plus a <c>HasVessel</c> that
        /// returned true this frame; those plus a <c>FlightPlanExists</c> that
        /// returned true this frame; those plus an index taken from the matching
        /// <c>NumberOf*</c> in the same frame; and last, the two iterator reads,
        /// whose precondition is about the iterator we were handed rather than
        /// about the plugin.</para>
        /// </summary>
        public static readonly string[] Allowed =
        {
            // No handle. Keys the whole binding, and is the one call made before
            // anything else is trusted.
            "GetVersion",

            // Live handle only.
            "CurrentTime",

            // Live handle, and the guid-tolerant predicate that licenses the rest
            // of this group. `contains`, not `FindOrDie`: the only member of the
            // whole surface that may be called on a guid we have not just proved.
            "HasVessel",

            // Live handle plus HasVessel. Every one of these routes through
            // FindOrDie on the guid, so the predicate is the whole of what stands
            // between a recovered vessel and a process abort.
            "VesselVelocity",
            "VesselTangent",
            "VesselNormal",
            "VesselBinormal",
            "VesselGetPredictionAdaptiveStepParameters",
            "VesselGetAnalysis",
            "FlightPlanExists",
            "FlightPlanCount",
            "FlightPlanSelected",

            // Plus FlightPlanExists. A vessel with no plan aborts on any of these,
            // and the count being positive in an earlier frame proves nothing.
            "FlightPlanGetInitialTime",
            "FlightPlanGetDesiredFinalTime",
            "FlightPlanGetActualFinalTime",
            "FlightPlanGetAnomalousStatus",
            "FlightPlanGetAdaptiveStepParameters",
            "FlightPlanNumberOfManoeuvres",
            "FlightPlanNumberOfSegments",
            "FlightPlanNumberOfAnomalousManoeuvres",
            "FlightPlanGetCoastAnalysis",

            // Plus an index from this frame's own NumberOf* call. The last of
            // these is bounded by the SEGMENT count against a doubled index, not
            // by the manoeuvre count, which is why it is reached through a
            // separate cursor type rather than the same loop.
            "FlightPlanGetManoeuvre",
            "FlightPlanGetManoeuvreFrenetTrihedron",
            "FlightPlanGetGuidance",
            "FlightPlanGetManoeuvreInitialPlottedVelocity",

            /*
             * Neither a handle nor a vessel, but an iterator over a native vector
             * that this frame's own analysis read allocated and gave us ownership
             * of. So the preconditions are the iterator's, not the plugin's.
             *
             * `IteratorAtEnd` dies on a null iterator and on nothing else, its whole
             * body being a null check and a comparison against the container's end.
             * `IteratorGetPlottableElements` has two more: a `dynamic_cast` to the
             * plottable-element iterator, and a `CHECK` against the end inside the
             * read itself. Neither is reachable here. The cast cannot fail while the
             * only iterator this assembly ever holds is an analysis's own
             * `plottable_elements`, and the end check cannot fail while every read
             * is preceded by `IteratorAtEnd` on the same iterator with no advance in
             * between.
             */
            "IteratorAtEnd",
            "IteratorGetPlottableElements",
        };

        /// <summary>
        /// Calls refused by name, each with the reason a caller gets told.
        ///
        /// <para>Named individually even though the family screens below would
        /// catch most of them, because the screen can only say "this looks like a
        /// write" while these can say what actually happens. An operator or a
        /// future author debugging a refusal wants the second.</para>
        /// </summary>
        public static readonly IReadOnlyDictionary<string, string> Refused =
            new Dictionary<string, string>
            {
                ["FlightPlanRenderedSegment"] =
                    "mutates: it recomputes flight-plan segments to avoid a deadline and moves the "
                    + "anomalous status, which the player's own flight planner then reads",
                ["VesselRequestAnalysis"] =
                    "mutates: it destroys every other vessel's orbit analyser and interrupts the "
                    + "player's in-flight analysis with our mission duration",
                ["FlightPlanRenderedClosestApproaches"] =
                    "aborts on the player's UI state: the native body opens with a check that a "
                    + "target vessel is selected, which we neither control nor can test for",
                ["RenderedPredictionClosestApproaches"] =
                    "aborts on the player's UI state: the native body opens with a check that a "
                    + "target vessel is selected, which we neither control nor can test for",
                ["FlightPlanRenderedApsides"] =
                    "aborts three frames down on the player's plotting-frame and target state, "
                    + "with no cheap predicate that could establish the precondition first",
                ["FlightPlanRenderedNodes"] =
                    "aborts three frames down on the player's plotting-frame and target state, "
                    + "with no cheap predicate that could establish the precondition first",
                ["RenderedPredictionApsides"] =
                    "aborts three frames down on the player's plotting-frame and target state, "
                    + "with no cheap predicate that could establish the precondition first",
                ["RenderedPredictionNodes"] =
                    "aborts three frames down on the player's plotting-frame and target state, "
                    + "with no cheap predicate that could establish the precondition first",
                ["CollisionNewPredictionExecutor"] =
                    "no cancel exists: creating an executor commits us to pumping its loop to "
                    + "completion in this frame, and every ordinary reason a poller has to bail "
                    + "out early aborts the process",
                // Read against the shipped revision's own source
                // (mockingbirdnest/Principia @ c6615048, the sha in this build's
                // release name), not inferred from the name.
                ["VesselGetPlottingFramePayload"] =
                    "takes the frame it looks up as an ARGUMENT, so it is a keyed map read "
                    + "rather than a source of one, and the payload it returns is a two-instant "
                    + "client scratchpad unrelated to a burn's frame; a zero extension reaches "
                    + "LOG(FATAL) in NewNavigationFrame and any index reaches the same "
                    + "unguardable celestial FindOrDie the Celestial family is refused for",
                ["VesselSetPlottingFramePayload"] =
                    "aborts on EVERY call whatever the arguments: the native body never calls "
                    + "its journal Method's Return, and the destructor's CHECK(returned_) is "
                    + "not gated on journalling being active. Live in the shipped binary; "
                    + "unnoticed upstream because nothing in the adapter calls it",
                ["VesselClearPlottingFramePayload"] =
                    "aborts on EVERY call whatever the arguments, the same unreturned journal "
                    + "Method as its Set sibling",
                ["CollisionNewFlightPlanExecutor"] =
                    "no cancel exists: creating an executor commits us to pumping its loop to "
                    + "completion in this frame, and every ordinary reason a poller has to bail "
                    + "out early aborts the process",
                ["CollisionGetLatitudeLongitude"] =
                    "part of the executor transaction, which cannot be abandoned partway through",
                ["CollisionSetRadius"] =
                    "part of the executor transaction, which cannot be abandoned partway through",
                ["CollisionDeleteExecutor"] =
                    "part of the executor transaction: deleting before the loop has finished "
                    + "aborts on the check that a result was produced",
                ["CelestialWorldDegreesOfFreedom"] =
                    "three abort vectors, one of which needs a live part id we cannot honestly "
                    + "supply from outside the flight scene",
                ["VesselFromParent"] =
                    "reparents the vessel whenever the index we pass disagrees with Principia's "
                    + "own, so it is a write wearing a read's shape",

                // The celestial family is refused for a reason none of the above
                // share, and it is the reason this whole layer is built the way it
                // is. These four are cleared as safe GIVEN a valid, non-root
                // celestial index, and there is no call on the surface that
                // establishes that. HasVessel exists for guids; nothing exists for
                // celestial indices, and a bad one is a FindOrDie abort. So the
                // precondition could only ever be asserted by the caller, which is
                // the documented-and-hoped-for shape this layer refuses to ship.
                // Reinstating them means finding a real predicate first.
                ["CelestialFromParent"] =
                    "no predicate exists for a valid, non-root celestial index, so the "
                    + "precondition could only be asserted rather than established, and a bad "
                    + "index aborts",
                ["CelestialRotation"] =
                    "no predicate exists for a valid celestial index, so the precondition could "
                    + "only be asserted rather than established, and a bad index aborts",
                ["CelestialRotationPeriod"] =
                    "no predicate exists for a valid celestial index, so the precondition could "
                    + "only be asserted rather than established, and a bad index aborts",
                ["CelestialInitialRotationInDegrees"] =
                    "no predicate exists for a valid celestial index, so the precondition could "
                    + "only be asserted rather than established, and a bad index aborts",
            };

        /// <summary>
        /// Read-shaped calls whose native bodies have NOT been read, listed so that
        /// reaching for one fails with the truth rather than with a generic "not on
        /// the list".
        ///
        /// <para>None of these is cleared, and none may be moved to
        /// <see cref="Allowed"/> on the strength of its name looking harmless. The
        /// analysis they are missing is the one that found that
        /// <c>FlightPlanRenderedSegment</c> is a write and that
        /// <c>VesselFromParent</c> reparents the vessel, both of which read as
        /// plain getters from the managed side.</para>
        /// </summary>
        public static readonly string[] Unanalysed =
        {
            "NavballOrientation",
            "PartGetActualRigidMotion",
            "PartIsTruthful",
            "UnmanageableVesselVelocity",
            "HasEncounteredApocalypse",
            "EquipotentialCount",
        };

        /// <summary>
        /// Name prefixes whose whole families are refused without further reading:
        /// the <c>Planetarium*</c> and <c>Graph*</c> surfaces, which serve
        /// rendering rather than telemetry and were never analysed.
        /// </summary>
        public static readonly string[] UnanalysedFamilies = { "Planetarium", "Graph" };

        /// <summary>
        /// Words that make a call a write, matched as WHOLE WORDS of the
        /// PascalCase name rather than as substrings.
        ///
        /// <para>The substring version is what a first draft reaches for and it is
        /// wrong in a way that costs real surface: <c>FlightPlanSelected</c>
        /// contains <c>Select</c> and is a cleared read that the ten-slot plan
        /// model needs, while <c>FlightPlanSelect</c> is the write we are actually
        /// screening for. Splitting the name into words separates them, because
        /// <c>Selected</c> is a different word from <c>Select</c>. A prefix match
        /// is no use either: none of these writes STARTS with its verb, they are
        /// all <c>FlightPlanCreate</c>, <c>FlightPlanRebase</c> and so on.</para>
        /// </summary>
        public static readonly string[] WriteVerbs =
        {
            "Create", "Delete", "Insert", "Remove", "Replace", "Select", "Set",
            "Rebase", "Duplicate",
            // `Clear` was missing, so VesselClearPlottingFramePayload fell past
            // the verb screen and landed on the not-audited branch instead. Both
            // still refuse, but for the wrong stated reason, and a refusal that
            // misdescribes itself is what sends the next reader looking in the
            // wrong place.
            "Clear",
        };

        /// <summary>
        /// Word sequences that name a refused family wherever they appear in a
        /// name, as opposed to <see cref="WriteVerbs"/>, which are single words.
        ///
        /// <para><c>OptimizationDriver</c> costs us <c>FlightPlanOptimizationDriverInProgress</c>,
        /// which the per-call analysis clears as a safe read. That forfeit is
        /// deliberate. The refusal is stated by name, and a name-based rule with a
        /// hand-carved exception in it is not a rule any more; the readout it buys
        /// (whether the player's optimiser is mid-run) is worth less than the
        /// screen staying mechanical. Reinstating it is a one-line change here
        /// plus a port method, made knowingly rather than by accident.</para>
        /// </summary>
        public static readonly string[] RefusedFamilies =
        {
            "Rendered", "Collision", "OptimizationDriver", "UpdatePrediction",
        };

        /// <summary>
        /// Throws unless <paramref name="name"/> is a call this assembly may bind.
        ///
        /// <para>Refusals are checked before the allowlist on purpose. If a name
        /// ever appears in both, the refusal has to win, or the allowlist becomes a
        /// way to launder a call past its own analysis.</para>
        /// </summary>
        public static void RequireAllowed(string name)
        {
            if (name == null)
            {
                throw new ArgumentNullException(nameof(name));
            }

            if (Refused.TryGetValue(name, out var reason))
            {
                throw new PrincipiaRefusedCallException(
                    "Refusing to bind Principia's '" + name + "': " + reason
                    + ". This is not a call to make safer; it is one to do without.");
            }

            var family = MatchedRefusedFamily(name);
            if (family != null)
            {
                throw new PrincipiaRefusedCallException(
                    "Refusing to bind Principia's '" + name + "': it belongs to the refused '"
                    + family + "' family. Nothing in that family is cleared, and a new member of "
                    + "it is not cleared by resembling one that is.");
            }

            var verb = MatchedWriteVerb(name);
            if (verb != null)
            {
                throw new PrincipiaRefusedCallException(
                    "Refusing to bind Principia's '" + name + "': '" + verb + "' names a write, "
                    + "and this Uplink only reads. Changing the player's game is outside what an "
                    + "observation channel may do, before crash safety is even discussed.");
            }

            if (Array.IndexOf(Unanalysed, name) >= 0 || MatchedUnanalysedFamily(name) != null)
            {
                throw new PrincipiaRefusedCallException(
                    "Refusing to bind Principia's '" + name + "': its native body has not been "
                    + "read. Read-shaped is not read: on this surface a getter has already turned "
                    + "out to recompute the flight plan, and another to reparent the vessel. Read "
                    + "the body, then add the name to PrincipiaCalls.Allowed with what you found.");
            }

            if (Array.IndexOf(Allowed, name) < 0)
            {
                throw new PrincipiaRefusedCallException(
                    "Refusing to bind Principia's '" + name + "': it is not on the audited list. "
                    + "Every call here aborts the KSP PROCESS on bad input rather than throwing, "
                    + "so there is nothing to catch and no try that helps. Read the native body at "
                    + "the installed revision, then add the name to PrincipiaCalls.Allowed.");
            }
        }

        /// <summary>True when the name may be bound, for tests and for reporting.</summary>
        public static bool IsAllowed(string name)
        {
            try
            {
                RequireAllowed(name);
                return true;
            }
            catch (PrincipiaRefusedCallException)
            {
                return false;
            }
        }

        private static string? MatchedRefusedFamily(string name)
        {
            foreach (var family in RefusedFamilies)
            {
                if (name.IndexOf(family, StringComparison.Ordinal) >= 0)
                {
                    return family;
                }
            }
            return null;
        }

        private static string? MatchedUnanalysedFamily(string name)
        {
            foreach (var family in UnanalysedFamilies)
            {
                if (name.StartsWith(family, StringComparison.Ordinal))
                {
                    return family;
                }
            }
            return null;
        }

        private static string? MatchedWriteVerb(string name)
        {
            foreach (var word in Words(name))
            {
                if (Array.IndexOf(WriteVerbs, word) >= 0)
                {
                    return word;
                }
            }
            return null;
        }

        /// <summary>
        /// Splits a PascalCase interface name into its words, so a verb can be
        /// matched as a word rather than as a substring of a longer one.
        ///
        /// <para>A run of capitals is kept together (<c>QP</c>, <c>XYZ</c>), which
        /// is what the surface's own names do.</para>
        /// </summary>
        private static IEnumerable<string> Words(string name)
        {
            var word = new StringBuilder();
            foreach (var c in name)
            {
                if (char.IsUpper(c) && word.Length > 0 && !char.IsUpper(word[word.Length - 1]))
                {
                    yield return word.ToString();
                    word.Length = 0;
                }
                word.Append(c);
            }
            if (word.Length > 0)
            {
                yield return word.ToString();
            }
        }
    }

    /// <summary>
    /// Thrown when something asks for a Principia call this assembly refuses to
    /// bind. Distinct from <see cref="PrincipiaProtocolException"/>: this one says
    /// the call may never be made, that one says it was made in the wrong order.
    /// </summary>
    public sealed class PrincipiaRefusedCallException : InvalidOperationException
    {
        public PrincipiaRefusedCallException(string message)
            : base(message)
        {
        }
    }
}
