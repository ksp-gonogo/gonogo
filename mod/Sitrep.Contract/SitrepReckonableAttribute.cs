using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// The reckoning vocabulary: which forward model carries a value between
    /// observations. One token per model, and the set is CLOSED: adding one is a
    /// statement that a new class of arithmetic is honest, which is a decision to
    /// take deliberately rather than a string to invent at a call site.
    ///
    /// <para>Mirrors the TypeScript <c>ReckoningBasis</c> union in
    /// <c>mod/sitrep-sdk/src/reading.ts</c>. That union keeps its own prose (what
    /// each model assumes and where it stops being true) because a widget author
    /// hovers it there; this catalogue is the machine-readable half.</para>
    /// </summary>
    public static class ReckoningBases
    {
        /// <summary>Two-body propagation of an orbital state. Honest until a burn, an SOI change or an unmodelled perturbation.</summary>
        public const string KeplerPropagation = "kepler-propagation";

        /// <summary>A position advanced by its last observed velocity. First-order, so honest for seconds where the true motion is curved.</summary>
        public const string LinearDeadReckoning = "linear-dead-reckoning";

        /// <summary>A quantity advanced by its last observed rate of change. Honest while the rate holds.</summary>
        public const string RateIntegration = "rate-integration";
    }

    /// <summary>
    /// Declares that THIS VALUE can be carried forward, by which model, from which
    /// published inputs.
    ///
    /// <para>Reckonability is a property of what the CONTRACT PUBLISHES, not of
    /// what a client happens to have implemented: an API consumer holding only the
    /// stream must be able to advance the value from the inputs named here. A
    /// registered reckoner is a convenience over published data, never the
    /// definition. Do not add a mark because our client can do the arithmetic; add
    /// it because the wire carries the arithmetic's inputs.</para>
    ///
    /// <para><b>Per value, never per topic.</b> A payload is a bundle of
    /// heterogeneous fields, and marking the bundle would stamp a model on the
    /// vessel's NAME. The generated projection is exactly the set of marked
    /// fields, so the SDK type says which fields a model moves and refuses a read
    /// of the others.</para>
    ///
    /// <para><b>Input spelling.</b> Each entry is one of:</para>
    /// <list type="bullet">
    /// <item>a bare path (<c>relativeVelocity</c>, <c>orbit.mu</c>): a camelCased
    /// property path on the SAME payload, walking nested contract types</item>
    /// <item><c>@&lt;topicId&gt;</c> (<c>@system.bodies</c>): the whole payload of
    /// another Topic</item>
    /// <item><c>@&lt;topicId&gt;#&lt;path&gt;</c> (<c>@vessel.orbit#mu</c>): a field
    /// path inside another Topic's payload</item>
    /// </list>
    /// <para>The <c>@</c> is what lets a reader and the gate tell a topic from a
    /// field without consulting the topic set, so a typo fails as "unknown topic"
    /// instead of silently re-resolving as a field path. The <c>#</c> is explicit
    /// rather than inferred because <c>vessel.orbit</c> and <c>vessel.orbit.truth</c>
    /// are both Topics in this contract today, and longest-prefix matching over that
    /// pair is a coin toss.</para>
    ///
    /// <para><b>The value's own property is an IMPLICIT input and must not be
    /// listed.</b> Every model is anchored on the value it advances, so listing it
    /// would appear on every mark and inform nobody. The gate REJECTS a
    /// self-reference so the convention cannot drift into optional.</para>
    ///
    /// <para><b><see cref="Basis"/> is a FLOOR, not a prediction.</b> It names the
    /// model the wire always supports for this value. A reckoner that has more on a
    /// given frame may report a better basis at runtime; what the mark promises is
    /// that at least this model is derivable from published inputs, always.</para>
    ///
    /// <para><b>A mark's availability is coupled to its SIBLINGS'.</b> One reading
    /// carries ONE projection over every marked field of a Topic, so the model
    /// answers for all of them or for none of them. A value whose own declared
    /// inputs all arrived is still withheld while a SIBLING value's input is
    /// missing, and the decline names the sibling's input:
    /// <see cref="Sitrep.Contract.VesselFlight.OrbitalSpeed"/> declares only
    /// <c>@vessel.orbit</c> and goes quiet when <c>@system.bodies</c>, which
    /// <c>AltitudeAsl</c> needs, has not arrived. So declaring an input a model
    /// does not use costs the marked value's siblings as well as itself.</para>
    ///
    /// <para><b>Composition, and the rule is the NEGATIVE one.</b> A derived value
    /// can never be reckonable BEYOND what its inputs support. Inputs being
    /// reckonable is necessary, never sufficient: deriving-then-advancing does not
    /// generally equal advancing-then-deriving, so "inputs are reckonable therefore
    /// the output is" is unsound and would manufacture exactly the confident-wrong
    /// reckoning this whole type exists to prevent. An input that is unmodellable by
    /// CONSTANCY (a catalogue, an identity) does not cap anything: carrying a
    /// constant forward is exact.</para>
    ///
    /// <internal>
    /// Nothing enforces the composition rule mechanically, and stages 1-4 of the
    /// reckoning pass deliberately do not try: it needs a machine-readable answer to
    /// "does this input move, and is it unmodelled", and the only classification in
    /// the tree is the SDK's <c>NEVER_RECKONABLE</c>, whose groups are comment-only.
    /// Splitting that list is the prerequisite, and it is a TS-side change, so the
    /// check cannot live here without resurrecting the cross-language ratchet that
    /// putting the declaration in the contract was meant to kill.
    /// </internal>
    /// </summary>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepReckonableAttribute : Attribute
    {
        /// <summary>One of the <see cref="ReckoningBases"/> tokens.</summary>
        public string Basis { get; }

        /// <summary>
        /// The published inputs the model needs, beyond the value itself. Never
        /// empty: a mark with no declared inputs is the pre-declaration state this
        /// attribute exists to end.
        /// </summary>
        public string[] Inputs { get; }

        public SitrepReckonableAttribute(string basis, params string[] inputs)
        {
            Basis = basis;
            Inputs = inputs ?? new string[0];
        }
    }
}
