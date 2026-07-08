using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Marks a concrete <c>ISitrepUplink</c> type for assembly-scan discovery
    /// — the kOS <c>kOSAddonAttribute</c> precedent
    /// (<c>local_docs/reference/kos/src/kOS/AddOns/kOSAddonAttribute.cs</c>),
    /// adapted for Uplinks. <see cref="Sitrep.Host.UplinkDiscovery"/> scans
    /// every loaded assembly that references <c>Sitrep.Contract</c> for
    /// types carrying this attribute and implementing
    /// <c>ISitrepUplink</c>, instantiates each via its PARAMETERLESS
    /// constructor (a discoverable Uplink must have one — a bundled Uplink
    /// that needs a real dependency, e.g. <c>VesselUplink</c>'s vessel
    /// actuator, resolves it itself inside that constructor rather than
    /// taking it as a discovery-time argument), and registers it.
    ///
    /// <see cref="ContractMajor"/>/<see cref="ContractMinor"/> default to
    /// <see cref="ContractVersion.Major"/>/<see cref="ContractVersion.Minor"/>
    /// — C# bakes a default PARAMETER value into the CALLER's metadata at
    /// COMPILE time (it is not a virtual/runtime lookup), so an Uplink
    /// attribute written as plain <c>[SitrepUplink("vessel")]</c> and never
    /// recompiled after a later contract Major bump keeps reporting the OLD
    /// version it actually shipped against — exactly the "what version was I
    /// built against" signal the discovery handshake needs. An Uplink is
    /// free to override these explicitly if it has a reason to declare
    /// support for something other than "whatever I was compiled against".
    /// </summary>
    [AttributeUsage(AttributeTargets.Class, Inherited = false, AllowMultiple = false)]
    public sealed class SitrepUplinkAttribute : Attribute
    {
        public string Id { get; }
        public int ContractMajor { get; }
        public int ContractMinor { get; }

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
