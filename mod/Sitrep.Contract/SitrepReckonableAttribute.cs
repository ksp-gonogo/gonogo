using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// The forward models that can carry a value between observations, one token
    /// per model. The set is closed: a <see cref="SitrepReckonableAttribute"/>
    /// names one of these, never a string of its own.
    ///
    /// <para>The same tokens as the SDK's <c>ReckoningBasis</c> union, which says
    /// what each model assumes and where it stops being accurate.</para>
    /// </summary>
    /// <category>Propagation and models</category>
    public static class ReckoningBases
    {
        /// <summary>Two-body propagation of an orbital state. Accurate until a burn, an SOI change or an unmodelled perturbation.</summary>
        public const string KeplerPropagation = "kepler-propagation";

        /// <summary>A position advanced by its last observed velocity. First-order, so accurate only for seconds where the true motion is curved.</summary>
        public const string LinearDeadReckoning = "linear-dead-reckoning";

        /// <summary>A quantity advanced by its last observed rate of change. Accurate while the rate holds.</summary>
        public const string RateIntegration = "rate-integration";

        /// <summary>
        /// A craft under thrust integrated forward under point-mass gravity and a steady burn: the
        /// observed thrust along its last measured direction, the mass falling at the published mass
        /// flow. Accurate until a command reaches the craft, the firing stage runs dry, or the burn's own
        /// uncertainty outgrows it.
        /// </summary>
        public const string PoweredIntegration = "powered-integration";

        /// <summary>
        /// Arithmetic over several readings resolved against one view time. Carries
        /// nothing forward itself: the forward step, where there was one, happened
        /// inside each input under its own basis, so this is accurate exactly as far
        /// as its inputs are and no further.
        ///
        /// <para>No contract field declares this basis. The SDK produces it on the
        /// client when it combines values the wire already carries.</para>
        /// </summary>
        public const string Combination = "combination";
    }

    /// <summary>
    /// Declares that a value can be carried forward between observations, by
    /// which model, from which published inputs.
    ///
    /// <para>The inputs named here must all be on the wire: a consumer holding
    /// only the stream can advance the value from them. Mark a value because the
    /// wire carries the model's inputs, not because some client can do the
    /// arithmetic.</para>
    ///
    /// <para>It goes on each property, never on a whole topic. The SDK's reckoned
    /// projection of a payload is exactly its marked fields, so it says which
    /// fields a model moves and refuses a read of the others.</para>
    ///
    /// <para><b>Several models.</b> Apply one mark per model; a value may carry several.
    /// <see cref="Sitrep.Contract.VesselFlight.AltitudeAsl"/> is a conic above the
    /// atmosphere and a rate integration below it, and the two need different
    /// inputs (the elements, against the descent rate and sensed deceleration), so
    /// each mark lists its own basis and inputs. Two marks with the same basis on
    /// one property are rejected by the build.</para>
    ///
    /// <para><b>Inputs.</b> Each entry is one of:</para>
    /// <list type="bullet">
    /// <item>a bare path (<c>relativeVelocity</c>, <c>orbit.mu</c>): a camelCased
    /// property path on the same payload, walking nested contract types</item>
    /// <item><c>@&lt;topicId&gt;</c> (<c>@system.bodies</c>): the whole payload of
    /// another Topic</item>
    /// <item><c>@&lt;topicId&gt;#&lt;path&gt;</c> (<c>@vessel.orbit#mu</c>): a field
    /// path inside another Topic's payload</item>
    /// </list>
    /// <para>The <c>@</c> marks a topic, so a misspelt topic fails as an unknown
    /// topic rather than being read as a field path. The <c>#</c> is required
    /// because one topic id can be a prefix of another (<c>vessel.orbit</c> and
    /// <c>vessel.orbit.truth</c>).</para>
    /// <para>Do not list the value's own property: every model is anchored on the
    /// value it advances, and the build rejects a self-reference.</para>
    ///
    /// <para><b>Basis is a minimum.</b> <see cref="Basis"/> names the model the wire always supports for this
    /// value. A reckoner with more data may report a better basis at run time.</para>
    ///
    /// <para><b>Siblings.</b> One reading carries one projection over every marked field of a Topic,
    /// so a model covers all of them or none. A value whose own inputs have all
    /// arrived is still withheld while a sibling's input is missing:
    /// <see cref="Sitrep.Contract.VesselFlight.OrbitalSpeed"/> declares only
    /// <c>@vessel.orbit</c> and is withheld until <c>@system.bodies</c>, which
    /// <c>AltitudeAsl</c> needs, has arrived. So list only the inputs a model cannot
    /// run without; one it merely refines with belongs to a registered reckoner, not
    /// the mark.</para>
    ///
    /// <para><b>Derived values.</b> A derived value is never reckonable beyond what its inputs support.
    /// Reckonable inputs are necessary but not sufficient, because deriving then
    /// advancing is not in general the same as advancing then deriving. An input
    /// that never changes (a catalogue, an identity) limits nothing. So where an
    /// input from another Topic is itself marked, the build requires the value's
    /// basis to be one that input is carried by.</para>
    ///
    /// <para><see cref="ReckoningBases.Combination"/> is never declared here: the build rejects it.</para>
    /// <internal>
    /// The check is ReckonabilityAssertion's, and it sees only marks. An input that
    /// moves and declares no model is held as observed and passes, since telling a
    /// rate a model assumes steady from an unmodelled quantity needs a verdict the
    /// contract does not record.
    /// </internal>
    /// </summary>
    /// <category>Propagation and models</category>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = true)]
    public sealed class SitrepReckonableAttribute : Attribute
    {
        /// <summary>One of the <see cref="ReckoningBases"/> tokens.</summary>
        public string Basis { get; }

        /// <summary>
        /// The published inputs the model needs, beyond the value itself, in the
        /// spelling the class summary describes. Never empty.
        /// </summary>
        public string[] Inputs { get; }

        /// <summary>Marks the property as carried forward by <paramref name="basis"/> from <paramref name="inputs"/>.</summary>
        /// <param name="basis">One of the <see cref="ReckoningBases"/> tokens.</param>
        /// <param name="inputs">The published inputs the model needs, beyond the value itself.</param>
        public SitrepReckonableAttribute(string basis, params string[] inputs)
        {
            Basis = basis;
            Inputs = inputs ?? new string[0];
        }
    }
}
