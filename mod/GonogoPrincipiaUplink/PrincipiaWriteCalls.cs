using System;
using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The register of which Principia flight-plan WRITES this assembly may bind,
    /// which it must never bind, and why.
    ///
    /// <para><b>Why this is a second register rather than more entries in
    /// <see cref="PrincipiaCalls"/>.</b> That one screens a name for a write verb
    /// and refuses it on sight, with the message "this Uplink only reads". The
    /// screen was right when nothing here wrote, and keeping it means the read
    /// surface still cannot acquire a write by someone adding a name to a list.
    /// A write has to be asked for through a different door, and this is the
    /// door.</para>
    ///
    /// <para><b>The enumeration behind it is closed, not sampled.</b> Principia's
    /// <c>FlightPlan</c> declares no friends and <c>Vessel</c>'s only friend is
    /// its own test class, so the set of things that can change a plan is exactly
    /// the two classes' non-const members, and intersecting that with the shipped
    /// export table gives thirteen. All thirteen are named below, in one of the
    /// two lists, so the register certifies its own completeness rather than
    /// listing what someone happened to want.</para>
    ///
    /// <para>Refusals are checked before the allowlist, on
    /// <see cref="PrincipiaCalls"/>'s rule: an allowlist that can override its own
    /// refusals is a way to launder a call past its analysis.</para>
    /// </summary>
    public static class PrincipiaWriteCalls
    {
        /// <summary>
        /// Every write this assembly may bind, each cleared against the exact
        /// installed revision, and each reachable only through the gate type that
        /// carries its preconditions.
        ///
        /// <para>Being on this list is not permission to call the thing. Five of
        /// the eight report failure as a recoverable status; three report nothing
        /// at all and are only observable by re-reading the plan, which is why
        /// every write on this surface answers with a re-read rather than with an
        /// acknowledgement.</para>
        /// </summary>
        public static readonly string[] Allowed =
        {
            // Round-tripped struct, index bounded by the manoeuvre count read in
            // the same frame. Insert takes index == count (it appends); Replace
            // aborts on it. The two bounds differ by exactly that, which is the
            // kind of difference that gets copy-pasted wrong, so they are reached
            // through separate gate methods.
            "FlightPlanInsert",
            "FlightPlanReplace",
            "FlightPlanRemove",

            // No struct, so no layout exposure. Recoverable on a time before the
            // last coast begins, and the cheapest mutator in the family.
            "FlightPlanSetDesiredFinalTime",

            // Round-tripped struct. Never constructed: two of its five fields are
            // integrator kinds drawn from disjoint sets over different equations,
            // and handing over the wrong one is an abort with no message.
            "FlightPlanSetAdaptiveStepParameters",

            // The plan slots. Create and Duplicate are capped at ten by us,
            // because nothing native caps them and an eleventh plan makes the
            // producer's own planner window throw on every layout pass. Delete is
            // the most dangerous entry point in the family and the reason the
            // gate exists; see PrincipiaPlanWriteGate.Delete.
            "FlightPlanCreate",
            "FlightPlanDelete",
            "FlightPlanDuplicate",
        };

        /// <summary>
        /// The reads this Uplink needs in order to make a write SAFE, which the
        /// read register refuses for reasons that were right about the readout and
        /// are wrong about the guard.
        ///
        /// <para><c>FlightPlanOptimizationDriverInProgress</c> was forfeited as a
        /// readout: it belongs to a family refused by name, and the note beside
        /// that refusal says reinstating it should be a deliberate one-line change
        /// rather than a carved-out exception. This is that change, and the reason
        /// is no longer a readout. A write made while the producer's optimiser is
        /// running is REVERTED, wholesale and silently, because the optimiser
        /// publishes a fresh candidate plan and the producer's planner window
        /// swaps it over the live one every frame. Without this call there is no
        /// way to tell an operator that their edit will be discarded, and the
        /// alternative guard, rebuilding the optimiser ourselves, means calling a
        /// driver constructor that takes a frame and can abort on the OPTIMISER's
        /// thread, hours from our stack.</para>
        ///
        /// <para>Its precondition is stricter than the read register's table
        /// claimed for it, and the correction is load-bearing: the native body
        /// reaches into the plan's variant with no deserialisation test, so on a
        /// plan that is still the lazily-held alternative it throws
        /// <c>std::bad_variant_access</c> ACROSS the native boundary, and on a
        /// vessel with no plan it aborts. It needs a plan to exist AND a
        /// materialising read to have happened in the same frame, which is what
        /// <c>PrincipiaMaterialisedPlanGate</c> is for.</para>
        /// </summary>
        public static readonly string[] AllowedReads =
        {
            "FlightPlanOptimizationDriverInProgress",
        };

        /// <summary>
        /// The five remaining writes, refused by name, each with what actually
        /// happens.
        ///
        /// <para>Named rather than screened, so the next author reads the hazard
        /// instead of rediscovering it. Every one of these is reachable and none
        /// of them is refused for being dangerous to call: they are refused
        /// because of what they do AFTER succeeding.</para>
        /// </summary>
        public static readonly IReadOnlyDictionary<string, string> Refused =
            new Dictionary<string, string>
            {
                ["FlightPlanSelect"] =
                    "desyncs the producer's own planner window in a way that does not heal: it "
                    + "rebuilds its burn editors only when the manoeuvre COUNT changes, so "
                    + "switching between two plans with the same number of burns leaves the "
                    + "window editing the previous plan's burns and holding the previous plan's "
                    + "end instant, and the next thing the player types goes to the new plan "
                    + "carrying the old one's number. Nothing exported resynchronises it",
                ["FlightPlanRebase"] =
                    "re-inserts every future manoeuvre with the error ignored, so manoeuvres that "
                    + "no longer fit the rebased plan are silently dropped and the call still "
                    + "reports success. A write whose partial failure is indistinguishable from "
                    + "success is one an operator cannot act on",
                ["FlightPlanOptimizationDriverMake"] =
                    "takes a reference frame, and its inclination metric builds that frame inside "
                    + "a lambda evaluated LATER, on the optimiser's own thread. A frame kind the "
                    + "producer's factory does not handle is a fatal log there rather than here, "
                    + "with no stack anywhere near the call that caused it",
                ["FlightPlanOptimizationDriverStart"] =
                    "bounds its manoeuvre index on the optimiser's worker thread, asynchronously, "
                    + "so an index that was valid when we read the count and stale by the time the "
                    + "thread got to it aborts the game with nothing of ours on the stack",
                ["FlightPlanUpdateFromOptimization"] =
                    "replaces the WHOLE plan with the optimiser's last candidate, which may be an "
                    + "answer the player wanted an hour ago. It is the mechanism by which our own "
                    + "writes get reverted, and calling it deliberately is choosing that outcome",
            };

        /// <summary>
        /// Throws unless <paramref name="name"/> is a write this assembly may
        /// bind.
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
                    "Refusing to bind Principia's write '" + name + "': " + reason
                    + ". This is not a call to make safer; it is one to do without.");
            }

            if (Array.IndexOf(Allowed, name) < 0 && Array.IndexOf(AllowedReads, name) < 0)
            {
                throw new PrincipiaRefusedCallException(
                    "Refusing to bind Principia's write '" + name + "': it is not on the audited "
                    + "write list. A write here is persisted into the player's save and cannot be "
                    + "un-written, and several of them abort the KSP PROCESS on bad input rather "
                    + "than returning an error. Read the native body at the installed revision, "
                    + "then add the name to PrincipiaWriteCalls.Allowed with the preconditions you "
                    + "found and the gate that carries them.");
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
    }
}
