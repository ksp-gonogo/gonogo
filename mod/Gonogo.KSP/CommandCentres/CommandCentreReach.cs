using System;
using System.Collections.Generic;

namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// Whether a candidate command centre is REACHABLE, which is a different
    /// question from whether commands may terminate there.
    ///
    /// <para><b>The defect this exists to close.</b> <c>CommNode.isControlSource</c>
    /// says "a command that arrives here can be obeyed". It says nothing about
    /// whether anything can arrive. Stock <c>CommNetwork.SetNodeConnection</c>
    /// disconnects any pair where either endpoint's
    /// <c>antennaRelay.power + antennaTransmit.power</c> is zero, and it does so
    /// BEFORE distance or occlusion are consulted, so a node with no antenna forms
    /// no link with anything at any distance, including the ship one metre away.
    /// Offering such a node as a vantage offers an operator a seat CommNet can
    /// never route to.</para>
    ///
    /// <para><b>The sum, never one half.</b> Stock's own gate adds the two powers,
    /// and it has to: <c>CommNetVessel.UpdateComm</c> MOVES a vessel's transmit
    /// power into the relay slot and zeroes transmit whenever transmit is the
    /// larger, so a healthy relay-capable craft sits at
    /// <c>antennaTransmit.power == 0</c> and a test on either half alone would
    /// reject it.</para>
    ///
    /// <para><b>Why the antenna PARTS are asked as well.</b> The two power fields
    /// belong to stock's range model, and a mod that replaces the range model is
    /// free to stop maintaining them. RealAntennas does exactly that: its
    /// <c>RACommNetVessel.UpdateComm</c> zeroes both and never writes them again,
    /// keeping reachability in its own antenna list, and its <c>RACommNetwork</c>
    /// logs an error if <c>SetNodeConnection</c> is ever called. On an install with
    /// RealAntennas a power-only test is not merely weaker, it is false for every
    /// vessel in the game and would empty the crewed half of the roster. The part
    /// walk is the portable half: <c>RealAntennas.ModuleRealAntenna</c> derives from
    /// <c>ModuleDataTransmitter</c>, so both networks agree that a craft carrying an
    /// <c>ICommAntenna</c> module carries an antenna.</para>
    ///
    /// <para><b>Capability, not connectivity.</b> Neither half asks whether the node
    /// is linked right now. A centre behind a planet, out of range, or with its
    /// antenna retracted is unreachable this second and still a place an operator
    /// may sit and queue commands from; dropping it would make the roster flicker
    /// with the geometry. What is excluded is the node that can NEVER form a link,
    /// which is the defect.</para>
    ///
    /// <para>Generic over the part type so the rule compiles and is exercised on
    /// every checkout: the live reads it takes its arguments from need a scene and
    /// cannot be entered headlessly at all. Same discipline as
    /// <c>CommNetOcclusion</c> and <c>LiveOriginDelay</c>.</para>
    /// </summary>
    internal static class CommandCentreReach
    {
        /// <param name="antennaTransmitPower">The node's <c>antennaTransmit.power</c>.</param>
        /// <param name="antennaRelayPower">The node's <c>antennaRelay.power</c>.</param>
        /// <param name="parts">
        /// The craft's parts, or null when they cannot be read (a vessel on rails
        /// with no ProtoVessel). Null, and an empty sequence, are both answered
        /// REACHABLE: "we could not look" and "we looked and found nothing" are
        /// different facts, and only the second is grounds for withdrawing a centre
        /// the operator can see.
        /// </param>
        /// <param name="carriesAntenna">Whether one part carries a CommNet antenna module.</param>
        internal static bool CanBeReached<TPart>(
            double antennaTransmitPower,
            double antennaRelayPower,
            IEnumerable<TPart>? parts,
            Func<TPart, bool> carriesAntenna)
        {
            // Stock's own gate, verbatim, including its NaN behaviour: a power that
            // is not a number is not a zero, and a node whose power is unreadable is
            // not one we have shown to be unreachable.
            if (antennaTransmitPower + antennaRelayPower != 0.0)
            {
                return true;
            }

            if (parts == null)
            {
                return true;
            }

            var sawAPart = false;
            foreach (var part in parts)
            {
                sawAPart = true;
                if (carriesAntenna(part))
                {
                    return true;
                }
            }

            // No parts at all is the same failed read as a null list, said a
            // different way: a craft with zero parts is not a craft, it is a
            // moment mid-load or mid-teardown, and a centre must not blink out of
            // the operator's picker because we caught it in one.
            return !sawAPart;
        }
    }
}
