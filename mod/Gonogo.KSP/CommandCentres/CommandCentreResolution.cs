using System;
using CommNet;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using UnityEngine;

namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// Names the command centre a control path terminated at, by matching the
    /// elected backend's terminus against core's own centre registry.
    ///
    /// <para><b>Core's half of a two-part question.</b> WHICH node the path ends
    /// at is a fact about the path and belongs to whichever backend solved it
    /// (<see cref="ICommsBackend.ControlPathTerminus"/>). Turning that node into
    /// a NAME is core's: the registry is core's, its ids are core's, and an
    /// Uplink may not even reference the type. Splitting it here is what let
    /// <c>comms.commandCentre</c> come off the
    /// <c>backend is CommNetBackend</c> downcast that used to gate it, under
    /// which the channel was all-null forever on a RealAntennas install and so
    /// indistinguishable from having no connection.</para>
    ///
    /// <para><b>Matched by REFERENCE, against the same live centres
    /// <c>commandCentre.roster</c> enumerates</b>, so the two channels can never
    /// name the terminus differently. Not by id, name or position: a station
    /// that moved or was renamed between passes would match the wrong entry, and
    /// the node itself is the only identity both sides already share.</para>
    /// </summary>
    internal static class CommandCentreResolution
    {
        /// <summary>
        /// The centre <paramref name="terminus"/> is, or an all-null payload
        /// when it is nothing the registry knows.
        ///
        /// <para>All-null is the contract's documented "no live remote centre
        /// right now", and it now means only that: no path, a path ending at
        /// neither a station nor a crewed source, or a terminus no registered
        /// centre claims. What it no longer means is "core declined to ask this
        /// backend", which was the state it could not be told apart
        /// from.</para>
        ///
        /// <para><paramref name="meta"/> rides through untouched, because a
        /// payload that named no centre still has to say which craft and what
        /// quality it was read at.</para>
        /// </summary>
        internal static CommsCommandCentre Resolve(
            object? terminus,
            CommandCentreRegistry? registry,
            PayloadMeta meta)
        {
            var unknown = new CommsCommandCentre { Meta = meta };
            if (terminus is not CommNode node || registry == null)
            {
                return unknown;
            }

            try
            {
                foreach (var centre in registry.EnumerateActive())
                {
                    if (centre is KspCommandCentre ksp && ReferenceEquals(ksp.Node, node))
                    {
                        return new CommsCommandCentre
                        {
                            Id = ksp.Id,
                            DisplayName = ksp.DisplayName,
                            Kind = ksp.Kind.ToString(),
                            BodyIndex = ksp.BodyIndex,
                            Meta = meta,
                        };
                    }
                }
            }
            catch (Exception ex)
            {
                // A source that threw mid-enumeration is a registry problem, not
                // a comms one, and it must not take the whole capture with it:
                // the rest of the comms payloads for this tick are already read
                // and correct. Unnamed is the honest answer.
                Debug.LogWarning(
                    "[Gonogo] command-centre resolution failed (treating as unnamed): " + ex.Message);
            }

            return unknown;
        }
    }
}
