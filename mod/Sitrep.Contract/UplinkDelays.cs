using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>
    /// The one-way delay a delayed command takes from a command centre to the
    /// target it addresses, for a command whose target is not the active craft:
    /// a career order to the home command, an aim to a lens, an order to another
    /// craft. One entry in <see cref="UplinkDelayReport.Elsewhere"/>.
    /// </summary>
    /// <category>Comms</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class UplinkDelay
    {
        /// <summary>The command, e.g. <c>career.tech.unlock</c>.</summary>
        [SitrepUnit(Units.Id)]
        public string Command { get; set; } = "";

        /// <summary>The command centre the delay is from, as a <c>commandCentre.roster</c> id.</summary>
        [SitrepUnit(Units.Id)]
        public string Centre { get; set; } = "";

        /// <summary>
        /// The one-way delay from <see cref="Centre"/> to the command's target,
        /// as the centre knows it: the figure that held one such delay before
        /// now, since news of a delay takes that delay to arrive. Null while the
        /// centre knows no delay to the target, which includes a target that
        /// depends on the command's arguments and a centre with no route to it.
        /// Never a zero for either.
        /// </summary>
        [SitrepUnit(Units.Seconds)]
        public double? OneWaySeconds { get; set; }
    }

    /// <summary>
    /// The <c>system.uplink.delays</c> payload: which delayed commands address
    /// the active craft, and the delay each of the others takes from the
    /// receiving session's command centre. Useful for showing the operator how
    /// long a command takes to arrive when it is sent somewhere other than the
    /// craft being flown.
    ///
    /// <para>A delayed command in neither list has no known target. Every
    /// command is listed as it is with no arguments, so a command whose target
    /// is named by an argument is listed in <see cref="Elsewhere"/> with no
    /// figure.</para>
    ///
    /// <para>Each session is sent the entries for its own command centre.</para>
    /// </summary>
    /// <category>Comms</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class UplinkDelayReport
    {
        /// <summary>Every delayed command whose target is the active craft, which takes that craft's own delay (<c>comms.delay</c>, or the centre's row on <c>commandCentre.activeVesselDelay</c>).</summary>
        [SitrepUnit(Units.Id)]
        public List<string> ActiveVessel { get; set; } = new List<string>();

        /// <summary>Every other delayed command, with its delay from the session's command centre.</summary>
        public List<UplinkDelay> Elsewhere { get; set; } = new List<UplinkDelay>();
    }
}
