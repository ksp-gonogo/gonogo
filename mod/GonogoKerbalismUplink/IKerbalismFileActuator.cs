using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// The live-Drive actuation seam for the File Manager commands, one method
    /// per verb, taking an already-resolved subject id (and, for the two
    /// toggles, the desired state) and returning an already-typed result. The
    /// Kerbalism-domain twin of <c>Sitrep.Host.IScienceActuator</c>:
    /// <see cref="KerbalismFileCommandProvider"/> (KSP-free, this assembly)
    /// resolves the subject against the captured drive snapshot and does the
    /// kind check before ever reaching here; it never touches KSP or
    /// Kerbalism itself, only this interface.
    ///
    /// <para>The live implementation reflects over Kerbalism's <c>Drive</c>
    /// (<c>Send</c>/<c>Delete_file</c>/<c>Analyze</c>/<c>Delete_sample</c>, plus
    /// a composed <c>Record_sample</c>+<c>Delete_sample</c> pair for
    /// <see cref="MoveToLab"/>, ground-truthed in
    /// <c>local_docs/design/2026-08-14-kerbalism-science-widget-integration-research.md</c>
    /// §3), and must run on the same main thread every other live PartModule
    /// read in this Uplink does. A fake implementation is what
    /// <see cref="KerbalismFileCommandProvider"/>'s unit tests exercise
    /// instead: the same KSP-free/real-impl split <c>IScienceActuator</c>/
    /// <c>KspScienceActuator</c> already established.</para>
    ///
    /// <para>Every method operates on <c>FlightGlobals.ActiveVessel</c>, the
    /// same "the vessel" scoping every other command in this mod uses. A
    /// live implementation with no active vessel returns
    /// <see cref="CommandErrorCode.NoVessel"/>; a subject id that no longer
    /// resolves on the live drive walk (removed since the last capture, or
    /// never existed) returns <see cref="CommandErrorCode.NotFound"/>. The
    /// subject-exists-and-is-the-right-kind check <see cref="KerbalismFileCommandProvider"/>
    /// already did against the captured snapshot is a fast, KSP-free
    /// pre-filter, not a substitute for this: the live drive can have moved on
    /// since that snapshot was taken, so an implementation must still resolve
    /// for real and never assume the pre-filter's answer still holds.</para>
    /// </summary>
    public interface IKerbalismFileActuator
    {
        /// <summary>Set (or clear) Kerbalism's queued-for-transmission flag on a stored file (<c>Drive.Send</c>).</summary>
        CommandResult SetSendFlagged(string subjectId, bool flag);

        /// <summary>Delete a stored file outright (<c>Drive.Delete_file</c>). Irreversible.</summary>
        CommandResult DeleteFile(string subjectId);

        /// <summary>Set (or clear) Kerbalism's lab-analysis flag on a stored sample (<c>Drive.Analyze</c>).</summary>
        CommandResult SetAnalyzeFlagged(string subjectId, bool flag);

        /// <summary>Dump a stored sample outright (<c>Drive.Delete_sample</c>). Irreversible.</summary>
        CommandResult DumpSample(string subjectId);

        /// <summary>
        /// Physically relocate a stored sample onto a lab-capable drive
        /// elsewhere on the same vessel (never cross-vessel). No target lab is
        /// selectable from the wire yet (see <c>KerbalismSubjectActionArgs</c>'s
        /// header comment on why); the implementation picks its own
        /// destination among the vessel's drives.
        /// </summary>
        CommandResult MoveToLab(string subjectId);
    }
}
