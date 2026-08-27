using System;
using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;

namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// The core's side of the <c>"derivedCurrency"</c> capability: tells every
    /// registered arm when a primary currency change was asked for and when the
    /// interceptor neutralised one, so a quantity some other mod derives from
    /// that change stays withheld for as long as the change is.
    ///
    /// <para>A static pointer to the live <see cref="Kernel"/>, the same shape
    /// <c>CommsCoreUplink.ConfigureSimulationKernel</c> uses and for the same
    /// reason: the interceptor is owned by a <c>ScenarioModule</c>, which has no
    /// <c>IUplinkHost</c> and therefore no kernel of its own. It holds no derived
    /// state, only the reference, so the "all pending state lives in the
    /// persisted scenario module" invariant is untouched.</para>
    ///
    /// <para><b>Resolved on every call, never cached.</b>
    /// <c>ChannelEngine.ResolveCapabilities</c> runs after the last uplink's
    /// <c>Register</c>, so an arm list captured at bind time would be empty for
    /// the whole session. Asking the kernel each time is two dictionary lookups
    /// and cannot be stale.</para>
    ///
    /// <para>No KSP or Unity type appears here, so unlike its caller this file
    /// compiles and is exercised headlessly.</para>
    /// </summary>
    public static class DerivedCurrencyWithholding
    {
        private static Kernel? _kernel;

        /// <summary>Whether the capability was reachable the last time an arm was asked for, so a caller can tell "no mod derives anything" from "nobody bound a kernel".</summary>
        public static bool Bound => _kernel != null;

        /// <summary>Why the pointer was last bound, so a teardown can name the bind it undid.</summary>
        private static string _lastBindReason = "";

        /// <summary>Why the pointer was last torn down, so an unwithheld credit can name the cause instead of leaving it to be reconstructed from scene logs.</summary>
        private static string _lastTeardownReason = "";

        /// <summary>
        /// Points this at a kernel and SAYS SO, naming what caused it and how many
        /// arms are active at that moment.
        ///
        /// <para>The announcement is the point. A bind and a teardown that both say
        /// nothing leave silence meaning "bound fine" and "nobody home" at once, and
        /// that ambiguity is what let a torn-down fan-out ship: the fix was deployed,
        /// watched to fail, and there was no way to tell which of the two it was.
        /// A count of zero and a count of one are different worlds and must not read
        /// the same, so both are stated.</para>
        ///
        /// <para><paramref name="reason"/> is the caller's, because only the caller
        /// knows: this file cannot see a scene transition, and it cannot tell "before
        /// capability resolution" from "resolved and nothing registered" either, since
        /// both answer zero.</para>
        /// </summary>
        public static void Bind(Kernel? kernel, string reason = "")
        {
            _kernel = kernel;
            _lastBindReason = Describe(reason);

            if (kernel == null)
            {
                // Bind(null) is a teardown spelled differently, and it used to be a
                // silent one.
                Unbind(reason);
                return;
            }

            var arms = ActiveArmIds();
            Note("[Gonogo] derived-currency: BOUND on " + _lastBindReason + ", "
                + arms.Count + " arm(s) active"
                + (arms.Count == 0 ? "" : ": " + string.Join(", ", arms)));
        }

        /// <summary>
        /// Clears the pointer, LOUDLY. A warning rather than a note, because from
        /// here until something binds again nothing derived from a delayed currency
        /// change is withheld, and a teardown with no BOUND line after it is exactly
        /// the state that shipped: torn down 99 seconds into boot by a main-menu
        /// transition, under a comment asserting a re-Register that a once-per-process
        /// addon makes impossible.
        /// </summary>
        public static void Unbind(string reason = "")
        {
            var wasBound = _kernel != null;
            _kernel = null;
            _lastTeardownReason = Describe(reason);

            if (!wasBound)
            {
                return;
            }

            Report("[Gonogo] derived-currency: TORN DOWN on " + _lastTeardownReason
                + " (was bound on " + _lastBindReason + "). Nothing derived from a delayed currency "
                + "change will be withheld until something binds a kernel again");
        }

        private static string Describe(string reason) =>
            string.IsNullOrEmpty(reason) ? "an unnamed caller" : reason;

        /// <summary>
        /// A change to <paramref name="primaryCurrency"/> has been asked for.
        /// Fans out to every arm so each can record its pre-derivation reading.
        /// </summary>
        public static void ObserveBeforeDerivation(string primaryCurrency, double ut)
        {
            foreach (var arm in Arms())
            {
                Safely(arm, "ObserveBeforeDerivation", () => arm.ObserveBeforeDerivation(primaryCurrency, ut));
            }
        }

        /// <summary>
        /// The provider ids of the arms this would fan out to right now, for the
        /// one line at startup that says whether an arm registered at all.
        ///
        /// <para>Its own reader rather than a count off <see cref="Arms"/>,
        /// because "which arms" is the whole question: an empty roster and a
        /// roster with <c>rp1</c> in it are the difference between a leak that is
        /// open and a leak that is closed, and until this existed neither of them
        /// said anything.</para>
        /// </summary>
        public static IReadOnlyList<string> ActiveArmIds()
        {
            var ids = new List<string>();
            foreach (var arm in Arms())
            {
                ids.Add(SafeId(arm));
            }
            return ids;
        }

        /// <summary>
        /// The interceptor has just neutralised a <paramref name="primaryCurrency"/>
        /// change of <paramref name="baseAmount"/>. Fans out to every arm so each
        /// can put back what its mod derived from it.
        /// </summary>
        public static void WithholdDerived(string primaryCurrency, double baseAmount, double ut)
        {
            var reached = new List<string>();
            foreach (var arm in Arms())
            {
                reached.Add(SafeId(arm));
                Safely(arm, "WithholdDerived", () => arm.WithholdDerived(primaryCurrency, baseAmount, ut));
            }

            AnnounceFanOut(primaryCurrency, baseAmount, ut, reached);
        }

        /// <summary>
        /// Says, every time a neutralise happens, how many arms it reached. This is
        /// the line that would have ended rig run <c>conf-fixed-1</c> in a minute
        /// instead of a session: the science was withheld correctly, the derived
        /// confidence moved anyway, and the whole fan-out was unreachable with
        /// nothing said about it either way. A no-op that cannot be told from a
        /// success is not a fail-soft, it is a silence.
        ///
        /// <para>Three outcomes, three levels, because they are three different
        /// facts. NOTHING BOUND is a warning: the interceptor is neutralising, so a
        /// game is running, so the pointer should be there and something took it
        /// away. NO ARMS is a note: on a stock install nothing derives anything and
        /// that is simply the truth. REACHED is a note naming the arms, so a
        /// following report from one of them has something to attach to.</para>
        /// </summary>
        private static void AnnounceFanOut(
            string primaryCurrency, double baseAmount, double ut, IReadOnlyList<string> reached)
        {
            if (!Bound)
            {
                Report("[Gonogo] derived-currency: a delayed " + primaryCurrency + " credit of "
                    + baseAmount.ToString("0.###", CultureInfo.InvariantCulture) + " at UT "
                    + ut.ToString("0.###", CultureInfo.InvariantCulture)
                    + " was neutralised with NO KERNEL BOUND, so no arm was asked and whatever any "
                    + "installed mod derived from it is STILL credited. Torn down on "
                    + _lastTeardownReason + " and never bound again");
                return;
            }

            if (reached.Count == 0)
            {
                Note("[Gonogo] derived-currency: a delayed " + primaryCurrency + " credit of "
                    + baseAmount.ToString("0.###", CultureInfo.InvariantCulture)
                    + " was neutralised and no installed mod has an arm registered, so nothing "
                    + "derived from it needed withholding");
                return;
            }

            Note("[Gonogo] derived-currency: asked " + string.Join(", ", reached)
                + " to withhold what it derived from a delayed " + primaryCurrency + " credit of "
                + baseAmount.ToString("0.###", CultureInfo.InvariantCulture) + " at UT "
                + ut.ToString("0.###", CultureInfo.InvariantCulture));
        }

        /// <summary>
        /// The active arms, or none at all when no kernel is bound or the
        /// capability was never declared. A capability the kernel does not know
        /// throws out of <c>Active</c>, which is the one case worth swallowing
        /// here: an install where this capability is absent is not an install
        /// where currency delay should stop working.
        /// </summary>
        private static IEnumerable<IDerivedCurrencyWithholder> Arms()
        {
            var kernel = _kernel;
            if (kernel == null)
            {
                yield break;
            }

            IReadOnlyList<object?> instances;
            try
            {
                instances = kernel.Active(DerivedCurrencyCapability.CapabilityId);
            }
            catch (Exception)
            {
                yield break;
            }

            foreach (var instance in instances)
            {
                if (instance is IDerivedCurrencyWithholder arm)
                {
                    // An arm's own assembly references no game or engine assembly, so
                    // it has nowhere to write; without this its refusals reached only
                    // a health fact on system.uplinks, and an operator at the rig
                    // cannot read one. Assigned here rather than once at resolution
                    // time because nothing tells this file when resolution happened,
                    // and the assignment is idempotent.
                    TrySetDiagnostic(arm);
                    yield return arm;
                }
            }
        }

        private static void TrySetDiagnostic(IDerivedCurrencyWithholder arm)
        {
            try
            {
                arm.Diagnostic = ArmDiagnostic;
            }
            catch (Exception ex)
            {
                Report("[Gonogo] derived-currency arm \"" + SafeId(arm)
                    + "\" would not take a diagnostic sink, so whatever it refuses to withhold will "
                    + "say so nowhere: " + ex.Message);
            }
        }

        /// <summary>
        /// One delegate for every arm, allocated once: <see cref="Arms"/> runs on
        /// every neutralise and a fresh closure per call would be per-earn garbage
        /// for nothing. Indirects through <see cref="Report"/> rather than capturing
        /// it, so installing a real sink after an arm has already been handed this
        /// one still reaches the log.
        /// </summary>
        private static readonly Action<string> ArmDiagnostic = message => Report?.Invoke(message);

        /// <summary>
        /// Runs one arm's call, reporting a throw rather than letting it reach the
        /// interceptor. An arm is third-party code reflecting into a third-party
        /// mod: it is the most likely thing here to throw, and a currency change
        /// must still be neutralised when it does.
        ///
        /// <para>Reported, never swallowed silently: an arm that throws every time
        /// is a leak that is still open, and a caught exception with nothing said
        /// about it is exactly how it would read as fixed.</para>
        /// </summary>
        private static void Safely(IDerivedCurrencyWithholder arm, string call, Action action)
        {
            try
            {
                action();
            }
            catch (Exception ex)
            {
                Report("[Gonogo] derived-currency arm \"" + SafeId(arm) + "\" threw out of " + call
                    + ", so whatever it derives is NOT withheld: " + ex.Message);
            }
        }

        private static string SafeId(IDerivedCurrencyWithholder arm)
        {
            try
            {
                return arm.ProviderId ?? "";
            }
            catch (Exception)
            {
                return arm.GetType().Name;
            }
        }

        /// <summary>
        /// Where a report goes. Assignable so the headless suite can read what was
        /// said: <c>UnityEngine.Debug</c> is the shipped destination and is not
        /// loadable here, and a warning nothing can observe is a warning that gets
        /// deleted by the next person who cannot see it firing.
        /// </summary>
        public static Action<string> Report { get; set; } = _ => { };

        /// <summary>
        /// Where the ROUTINE outcome goes, separately from <see cref="Report"/>: a
        /// fan-out that reached its arms is not a warning, and a subsystem that
        /// only ever speaks up when something breaks cannot be told from one that
        /// is not running at all. That indistinguishability is the whole of rig run
        /// <c>conf-fixed-1</c>.
        /// </summary>
        public static Action<string> Note { get; set; } = _ => { };
    }
}
