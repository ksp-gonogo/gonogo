using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The KSP seam for a part's right-click Part Action Window: enumerate the
    /// buttons one part currently exposes, and fire one. The PAW analogue of
    /// <see cref="IRoboticsActuator"/>, and deliberately the same two-method
    /// read+write shape, because the read half is what makes the write half
    /// usable (a client can only invoke a <see cref="PartActionEntry.Name"/> it
    /// was told about).
    /// <see cref="PartActionsViewProvider"/> (KSP-free, this assembly) does the
    /// dedup/ordering and the wire flatten and calls exactly these two methods;
    /// <c>Gonogo.KSP.KspPartActionActuator</c> is the real implementation (the
    /// <c>part.Events</c> + per-<c>PartModule</c> walk and
    /// <c>BaseEvent.Invoke()</c>), while
    /// <c>Sitrep.Host.Tests.FakePartActionActuator</c> is the record-and-return
    /// double the provider's unit tests exercise.
    ///
    /// <para>Both methods operate on <c>Gonogo.KSP.ActiveVesselScope.Current</c>: there is
    /// no per-call vessel selector, matching the read side's "the vessel"
    /// scoping and <see cref="IRoboticsActuator"/>'s. The <c>partId</c> is the
    /// <c>flightID.ToString()</c> the read side stamps on
    /// <see cref="VesselPart.Id"/>, so a client round-trips the id it already
    /// holds.</para>
    ///
    /// <para><b>Main-thread only.</b> Enumerating <c>BaseEvent</c>s reads live
    /// Unity/KSP state and <c>Invoke()</c> mutates it, so a real implementation
    /// is only ever called from the Unity main thread: the enumeration through
    /// the capture half of <see cref="IUplinkHost.AddSampledSource"/>, the
    /// invoke through the engine's command-handler pump. Calling either from the
    /// Courier thread is a crash / garbage-data risk, which is why the flatten
    /// and publish live in <see cref="PartActionsViewProvider"/> instead of
    /// here.</para>
    /// </summary>
    public interface IPartActionActuator
    {
        /// <summary>
        /// The PAW buttons the part with this <c>flightID.ToString()</c>
        /// currently exposes: the union of the part's own events and every one of
        /// its modules', filtered to <c>guiActive</c>. Returns an EMPTY list both
        /// when the part genuinely has no actions and when the id does not
        /// resolve: a read has no error channel, and the invoke command is where
        /// an unresolvable id is reported as
        /// <see cref="CommandErrorCode.NotFound"/>.
        /// </summary>
        IReadOnlyList<PartActionEntry> List(string partId);

        /// <summary>
        /// Fire one button. Returns a typed failure rather than throwing: no
        /// active vessel (<see cref="CommandErrorCode.NoVessel"/>), no part with
        /// that id (<see cref="CommandErrorCode.NotFound"/>: staged away,
        /// undocked, or the vessel unloaded), or the part resolved but exposes no
        /// such event (<see cref="CommandErrorCode.ModeUnavailable"/>).
        /// </summary>
        CommandResult Invoke(string partId, string eventName);
    }
}
