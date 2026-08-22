using System;
using System.Collections.Generic;
using Sitrep.Contract;
using UnityEngine;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Reads the producer's gravity model out of <c>GameDatabase</c> and publishes
    /// it as the force model an n-body integration runs against.
    ///
    /// <para><b>This is the only file in the gravity-model path that names a game
    /// type</b>, and it holds nothing but the read: finding the node and flattening
    /// each <c>body</c> block into string pairs. Every decision about what those
    /// pairs mean is in <see cref="GravityModelParser"/>, which is tested headless.
    /// Keep it that way; logic that migrates here stops being testable.</para>
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

        private readonly Func<IEnumerable<GravityModelBlock>?> _read;
        private GravityModel? _model;
        private bool _readOnce;

        public PrincipiaGravityModelSource()
            : this(ReadFromGameDatabase)
        {
        }

        /// <summary>Test seam: the blocks injected, so the parse and the caching are both reachable with no game.</summary>
        internal PrincipiaGravityModelSource(Func<IEnumerable<GravityModelBlock>?> read)
        {
            _read = read ?? throw new ArgumentNullException(nameof(read));
        }

        public string ProviderId => ProviderIdValue;

        public GravityModel? Model
        {
            get
            {
                if (!_readOnce)
                {
                    _readOnce = true;
                    try
                    {
                        _model = GravityModelParser.Parse(_read());
                    }
                    catch (Exception e)
                    {
                        // A throw here would take the whole registration down for a
                        // config file. Null is the honest answer and reaches a client
                        // as an install problem it can act on.
                        Debug.LogWarning(
                            "[Gonogo] Could not read the Principia gravity model, so no n-body "
                            + "trajectory will be published: " + e.Message);
                        _model = null;
                    }
                }
                return _model;
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
    }
}
