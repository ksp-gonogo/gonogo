using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.ActionGroups;

namespace Gonogo.KSP
{
    /// <summary>
    /// The always-present VANILLA action-groups backend — the structural
    /// counterpart to <see cref="CommNetBackend"/>, registered as the
    /// <c>"actionGroups"</c> capability's <c>Vanilla</c> factory by
    /// <see cref="VesselUplink.DeclareCapabilities"/>.
    ///
    /// <para>Stock KSP's <c>KSPActionGroup</c> enum genuinely only HAS ten
    /// customs (<c>Custom01..Custom10</c>), so enumerating exactly ten here is
    /// correct — it is not a hardcoded LIMIT, it is this backend reporting the
    /// truth about stock. The ten-ness now lives in ONE place (this backend)
    /// instead of being spelled out at every layer, and an AGX backend elected
    /// over this one simply reports a different, longer, player-named list
    /// through the same interface. Nothing downstream — contract, channel,
    /// client — knows or cares which backend answered.</para>
    ///
    /// <para>Stock has no per-group naming, so <see cref="ActionGroupState.Name"/>
    /// is <c>"AG1".."AG10"</c>: precisely the labels the client used to
    /// hardcode, now sourced from the mod. That is what makes the AGX phase a
    /// pure backend swap rather than a client change.</para>
    ///
    /// <para><b>Main thread only</b> — every method reads live KSP
    /// (<c>FlightGlobals.ActiveVessel</c>). See
    /// <see cref="IActionGroupsBackend"/>'s threading note: this is called
    /// from <see cref="KspHost"/>'s main-thread capture and from the
    /// command queue (which <see cref="GonogoAddon"/> drains on the main
    /// thread), never from a channel-source closure.</para>
    /// </summary>
    public sealed class StockActionGroupsBackend : IActionGroupsBackend
    {
        /// <summary>
        /// Stock's ten customs, indexed 0-based here and reported 1-based as
        /// <see cref="ActionGroupState.Index"/> — the same 1-based number
        /// <c>vessel.control.setActionGroup</c> takes, so an index read off a
        /// sample can be handed straight back in a command.
        /// </summary>
        private static readonly KSPActionGroup[] Customs =
        {
            KSPActionGroup.Custom01,
            KSPActionGroup.Custom02,
            KSPActionGroup.Custom03,
            KSPActionGroup.Custom04,
            KSPActionGroup.Custom05,
            KSPActionGroup.Custom06,
            KSPActionGroup.Custom07,
            KSPActionGroup.Custom08,
            KSPActionGroup.Custom09,
            KSPActionGroup.Custom10,
        };

        public IList<ActionGroupState>? Groups()
        {
            // BuildVesselEntry only ever samples FlightGlobals.ActiveVessel, and
            // IVesselActuator scopes every command to it too, so "the vessel" is
            // unambiguous here — same scoping as CommNetBackend.
            var actionGroups = FlightGlobals.ActiveVessel != null
                ? FlightGlobals.ActiveVessel.ActionGroups
                : null;
            if (actionGroups == null)
            {
                // Null, NOT an empty list: the contract's documented "no
                // action-group data this tick". An empty list would wrongly
                // assert "this vessel has zero groups" and blank the client.
                return null;
            }

            var groups = new List<ActionGroupState>(Customs.Length);
            for (var i = 0; i < Customs.Length; i++)
            {
                groups.Add(new ActionGroupState
                {
                    Index = i + 1,
                    Name = "AG" + (i + 1),
                    State = actionGroups[Customs[i]],
                });
            }
            return groups;
        }

        public bool SetGroup(int index, bool state)
        {
            // The backend owns the range check — that is the point of the seam.
            // VesselCommandProvider can no longer assume 1..10 (AGX goes to
            // 250), so it delegates the bound to whoever is elected.
            if (index < 1 || index > Customs.Length)
            {
                return false;
            }

            var actionGroups = FlightGlobals.ActiveVessel != null
                ? FlightGlobals.ActiveVessel.ActionGroups
                : null;
            if (actionGroups == null)
            {
                return false;
            }

            actionGroups.SetGroup(Customs[index - 1], state);
            return true;
        }
    }
}
