using System;
using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;
using UnityEngine;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Reads the producer's gravity model and publishes it as the force model an
    /// n-body integration runs against.
    ///
    /// <para><b>This is the only file in the gravity-model path that names a game
    /// type</b>, and it holds nothing but the two reads: finding the config node and
    /// flattening each <c>body</c> block into string pairs, and walking the star's
    /// own tree for installs where that node does not exist. Every decision about
    /// what those pairs mean, and which of the two sources wins, is in
    /// <see cref="GravityModelParser"/>, which is tested headless. Keep it that way;
    /// logic that migrates here stops being testable.</para>
    ///
    /// <para><b>Read once and held.</b> The model is configuration: it is the same
    /// on every tick of a session, and re-walking a few dozen config nodes per
    /// physics frame would spend real time to reach the same answer. A failed read
    /// is held too, as a null, because a database that had no such node when the
    /// game finished loading is not going to grow one.</para>
    /// </summary>
    public sealed class PrincipiaGravityModelSource : IGravityModelSource
    {
        public const string ProviderIdValue = "principia-gravity-model";

        private readonly Func<IEnumerable<GravityModelBlock>?> _readConfig;
        private readonly Func<IEnumerable<GravityModelBlock>?> _readBodyTree;
        private readonly object _gate = new object();
        private GravityModel? _model;
        private bool _readOnce;

        public PrincipiaGravityModelSource()
            : this(ReadFromGameDatabase, ReadFromBodyTree)
        {
        }

        /// <summary>Test seam: the blocks injected, so the parse and the caching are both reachable with no game.</summary>
        internal PrincipiaGravityModelSource(
            Func<IEnumerable<GravityModelBlock>?> readConfig,
            Func<IEnumerable<GravityModelBlock>?>? readBodyTree = null)
        {
            _readConfig = readConfig ?? throw new ArgumentNullException(nameof(readConfig));
            _readBodyTree = readBodyTree ?? (() => null);
        }

        public string ProviderId => ProviderIdValue;

        /// <summary>
        /// The force model, read once and held.
        ///
        /// <para>Under a lock because the caller is the <c>vessel.orbit</c> channel
        /// mapper on the Courier thread and nothing stops a second reader appearing:
        /// "read once" is a claim about how often the config is walked, and without
        /// the lock it would be a claim two threads could both falsify while both
        /// believing they had honoured it.</para>
        /// </summary>
        public GravityModel? Model
        {
            get
            {
                lock (_gate)
                {
                    if (!_readOnce)
                    {
                        _readOnce = true;
                        try
                        {
                            _model = GravityModelParser.Parse(_readConfig, _readBodyTree);
                        }
                        catch (Exception e)
                        {
                            // A throw here would take the whole registration down for
                            // a config file. Null is the honest answer and reaches a
                            // client as an install problem it can act on.
                            Debug.LogWarning(
                                "[Gonogo] Could not read the Principia gravity model, so no n-body "
                                + "trajectory will be published: " + e.Message);
                            _model = null;
                        }
                    }
                    return _model;
                }
            }
        }

        /// <summary>
        /// The <c>body</c> blocks of the one gravity-model node, flattened to string
        /// pairs.
        ///
        /// <para><b>At most one node, and more than one refuses.</b> The producer
        /// reads its own model the same way and asserts the same thing. Two nodes
        /// means two solar systems are configured, and picking either would be
        /// picking a set of masses at random for the curve to be integrated
        /// against.</para>
        /// </summary>
        private static IEnumerable<GravityModelBlock>? ReadFromGameDatabase()
        {
            var db = GameDatabase.Instance;
            if (db == null) return null;
            var nodes = db.GetConfigNodes(GravityModelParser.NodeName);
            if (nodes == null || nodes.Length != 1) return null;
            var node = nodes[0];

            var blocks = new List<GravityModelBlock>();
            foreach (var body in node.GetNodes("body"))
            {
                var values = new Dictionary<string, string>(StringComparer.Ordinal);
                for (var i = 0; i < body.values.Count; i++)
                {
                    var v = body.values[i];
                    if (v?.name == null) continue;
                    values[v.name] = v.value;
                }
                blocks.Add(new GravityModelBlock(values));
            }
            return blocks;
        }

        /// <summary>
        /// Every body the producer inserts, as the same string pairs a config node
        /// would have given: a name and a gravitational parameter, and nothing else.
        ///
        /// <para><b>The star and its descendants, not the body list.</b> The
        /// producer seeds its system with the star and then walks
        /// <c>orbitingBodies</c> down from it, so a body the game holds that is not
        /// reachable that way is never inserted and exerts no force at all.
        /// Enumerating the flat body list instead would publish attractors the
        /// integration does not have.</para>
        ///
        /// <para><b>Keyed on <c>bodyName</c>, which is both the key every other body
        /// table in this mod uses and the only one this thread may read.</b> The
        /// model is resolved inside the <c>vessel.orbit</c> channel mapper, which
        /// runs on the Courier thread, and <c>UnityEngine.Object.name</c> is a native
        /// accessor a non-Unity thread is not entitled to call: reaching for it would
        /// throw, be swallowed as "nothing attempted", and leave the feature looking
        /// dead with no complaint on the wire. <c>bodyName</c> is a plain managed
        /// field, and on the stock system it is the same string. Where a producer's
        /// own config spells a body differently the arc says so rather than going
        /// quiet: the term is dropped and the body is named on the payload.</para>
        ///
        /// <para>No reference radius and no zonal harmonic, deliberately. The
        /// producer's per-body route has nowhere to read them from and applies
        /// neither, so stating one here would describe a force the physics is not
        /// summing.</para>
        /// </summary>
        private static IEnumerable<GravityModelBlock>? ReadFromBodyTree()
        {
            var sun = Planetarium.fetch != null ? Planetarium.fetch.Sun : null;
            if (sun == null) return null;

            var blocks = new List<GravityModelBlock>();
            AppendBody(sun, blocks);
            return blocks.Count == 0 ? null : blocks;
        }

        /// <summary>
        /// One body and everything orbiting it, depth first. A body with no name or
        /// no positive gravitational parameter is skipped and its satellites are
        /// still walked: the gap belongs to that body, not to the branch.
        /// </summary>
        private static void AppendBody(CelestialBody body, List<GravityModelBlock> into)
        {
            if (body == null) return;

            var name = body.bodyName;
            if (!string.IsNullOrEmpty(name) && body.gravParameter > 0.0)
            {
                into.Add(new GravityModelBlock(new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    { GravityModelParser.NameKey, name },
                    {
                        GravityModelParser.GravitationalParameterKey,
                        body.gravParameter.ToString("R", CultureInfo.InvariantCulture)
                            + " " + GravityModelParser.MetresCubedPerSecondSquared
                    },
                }));
            }

            var orbiting = body.orbitingBodies;
            if (orbiting == null) return;
            for (var i = 0; i < orbiting.Count; i++)
            {
                AppendBody(orbiting[i], into);
            }
        }
    }
}
