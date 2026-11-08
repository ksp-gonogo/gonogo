using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// Stock Part Action Window buttons that open a window on the game's own
    /// screen that only someone there can finish, nearly all of them under an
    /// input lock. Fired from a console they lock the craft's controls with nobody
    /// able to release them, so they are left out of <c>vessel.partActions</c> and refused by
    /// <c>vessel.invokePartAction</c>.
    ///
    /// <para>Matched by event name alone, because a mod module that subclasses a
    /// stock one inherits the same button under its own module name.</para>
    /// </summary>
    public static class InGameOnlyPartActions
    {
        /*
         * Each one, as KSP 1.12 implements it:
         *  - SpawnTransferDialog (Part): opens the crew hatch dialog, whose Transfer
         *    button starts a CrewTransfer; PartItemTransfer.Setup locks every
         *    control but the UI and camera ("itemTransfer") until a part is clicked
         *    or Escape is pressed.
         *  - TransferDataEvent (ModuleScienceExperiment, ModuleScienceContainer):
         *    ExperimentTransfer.Create, the same PartItemTransfer lock.
         *  - RenameVessel (ModuleCommand): Vessel.RenameVessel opens the rename
         *    dialog under SetControlLock("vesselRenameDialog"), which locks all
         *    controls until the dialog is closed.
         *  - RenameAsteroidEvent (ModuleAsteroid), RenameCometEvent (ModuleComet): a
         *    rename prompt under SetControlLock("RenameDialog"), the same full lock.
         *    A grappled asteroid is a part of the active vessel.
         *  - RenameVessel also exists on KerbalEVA under the same name.
         *  - SetVesselNaming (ModuleGroundExpControl, and Part's own, which the
         *    game's vessel naming setting switches on at runtime):
         *    Part.SetVesselNaming opens the rename dialog under the same
         *    "vesselRenameDialog" lock.
         *  - ShowUpgradeStats (Part): a popup with an OK button and no control
         *    lock, listed because nobody at a console can close it.
         *
         * Buttons that open a window without such a lock (KerbNet, the robotics
         * controller editor, Review Data, a transmitter's partial-data prompt)
         * stay listed: they show something on the game's screen but leave the
         * craft controllable.
         */
        private static readonly HashSet<string> EventNames = new HashSet<string>
        {
            "SpawnTransferDialog",
            "TransferDataEvent",
            "RenameVessel",
            "RenameAsteroidEvent",
            "RenameCometEvent",
            "SetVesselNaming",
            "ShowUpgradeStats",
        };

        /// <summary>Whether the button with this <c>BaseEvent.name</c> is one only someone at the game can finish.</summary>
        public static bool IsInGameOnly(string? eventName) =>
            eventName != null && EventNames.Contains(eventName);
    }
}
