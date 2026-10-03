using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// What a single field of a payload needs the save to have unlocked, where
    /// the rest of its channel needs nothing: <c>vessel.orbit</c>'s elements
    /// are always known, its <c>encounter</c> only once the Tracking Station
    /// shows patched conics.
    ///
    /// <para>While the requirement fails, the field arrives as a
    /// <see cref="LockedValue"/> naming the missing unlock instead of the null
    /// that would read as "there is none". A client's type for the field
    /// carries that third arm, so a reader branches on it as it branches on a
    /// reading's currency.</para>
    ///
    /// <para>The same descriptor a command or channel requirement carries, and
    /// resolved by the same evaluators. Evaluated with no arguments, so it
    /// names no <see cref="CommandRequirement.Needs"/>.</para>
    /// </summary>
    /// <category>Channels and emission</category>
    [AttributeUsage(AttributeTargets.Property, Inherited = false, AllowMultiple = true)]
    public sealed class SitrepRequiresAttribute : Attribute
    {
        /// <summary>Requires what an evaluator of <paramref name="kind"/> decides.</summary>
        /// <param name="kind">The requirement kind, as on <see cref="CommandRequirement.Kind"/>.</param>
        public SitrepRequiresAttribute(string kind)
        {
            Kind = kind;
        }

        /// <summary>The requirement kind, as on <see cref="CommandRequirement.Kind"/>.</summary>
        public string Kind { get; }

        /// <summary>The facility it reads, as on <see cref="CommandRequirement.Facility"/>.</summary>
        public string Facility { get; set; } = "";

        /// <summary>Which capability or limit, as on <see cref="CommandRequirement.Quantity"/>.</summary>
        public string Quantity { get; set; } = "";

        /// <summary>The descriptor an evaluator resolves.</summary>
        /// <returns>A requirement with this attribute's kind, facility and quantity, and no needs.</returns>
        public CommandRequirement ToRequirement() =>
            new CommandRequirement { Kind = Kind, Facility = Facility, Quantity = Quantity };
    }
}
