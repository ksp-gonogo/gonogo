using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Marks an <see cref="ISitrepUplink"/> implementation for discovery.
    ///
    /// <para>Gonogo scans every loaded assembly that references
    /// <c>Sitrep.Contract</c> for classes carrying this attribute and
    /// implementing <see cref="ISitrepUplink"/>, and creates each through its
    /// public parameterless constructor. A dependency the Uplink needs is
    /// resolved inside that constructor, never passed in.</para>
    ///
    /// <para>The two version arguments default to the
    /// <see cref="ContractVersion"/> constants of the contract you compiled
    /// against, and the compiler inlines them into your assembly, so they record
    /// which contract your build assumed. Leave them alone. An Uplink whose
    /// contract major differs from the running mod's is refused:
    /// <see cref="ISitrepUplink.Register"/> is never called, and the Uplink is
    /// marked unavailable with both versions in the reason. A minor difference in
    /// either direction loads, because minor versions only add.</para>
    /// </summary>
    /// <category>Uplink API</category>
    [AttributeUsage(AttributeTargets.Class, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepUplinkAttribute : Attribute
    {
        /// <summary>The Uplink's registry-unique id. Must equal <see cref="UplinkManifest.Id"/>.</summary>
        public string Id { get; }

        /// <summary>The contract major this Uplink was built against.</summary>
        public int ContractMajor { get; }

        /// <summary>The contract minor this Uplink was built against.</summary>
        public int ContractMinor { get; }

        /// <summary>Declare an Uplink by id, stamped with the contract version it compiles against.</summary>
        /// <param name="id">The Uplink's id, the same string as its manifest's.</param>
        /// <param name="contractMajor">Leave defaulted: the compiled-against contract major.</param>
        /// <param name="contractMinor">Leave defaulted: the compiled-against contract minor.</param>
        public SitrepUplinkAttribute(
            string id,
            int contractMajor = ContractVersion.Major,
            int contractMinor = ContractVersion.Minor)
        {
            Id = id;
            ContractMajor = contractMajor;
            ContractMinor = contractMinor;
        }
    }
}
