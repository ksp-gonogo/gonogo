using System;
using System.Collections.Generic;
using System.IO;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.BodyTextures;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>bodies.texture.&lt;body&gt;</c> dynamic namespace: each celestial
    /// body's surface map as a PNG, read from the running game the first time
    /// its Topic is subscribed and kept for the rest of the game. Every body is
    /// served the same way, stock or from a planet pack; a body the game has no
    /// readable map for is kept as a frame with no segments.
    ///
    /// <para>Encoded maps are cached under <c>PluginData/body-textures</c>, so
    /// a later game sends them without reading the graphics card.</para>
    ///
    /// <para><b>Not an Uplink discovered by attribute scan, deliberately.</b> It
    /// ships inside <c>Gonogo.dll</c> and is registered directly by
    /// <see cref="GonogoAddon"/>, the way <see cref="PartShapeChannels"/> is.</para>
    /// </summary>
    public sealed class BodyTextureChannels : ISitrepUplink
    {
        /*
         * Maps travel as binary-lane Topics for the reason part shapes travel as
         * Topics: the mod's only listener is the stream's WebSocket, and a
         * station reaches the mod only through the main screen, whose relay
         * already carries binary-lane frames to it.
         */

        /*
         * The server is driven from the addon's Update rather than a sampled
         * source: a sampled source runs only in a game scene and at the sampling
         * rate, about once a second, and a map read takes a strip per call. So
         * a map is read at one strip per rendered frame, from the main menu on.
         */

        private IKeptChannelSource? _source;
        private BodyTextureServer? _server;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "bodyTextures",
            Bundled = true,
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>(),
        };

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            if (host is not ChannelEngine engine)
            {
                throw new InvalidOperationException("body maps need Gonogo's own channel engine as their host");
            }
            var directory = Path.Combine(KSPUtil.ApplicationRootPath, "GameData", "Gonogo", "PluginData", "body-textures");
            _server = new BodyTextureServer(
                new UnityBodyTextureSource(),
                new BodyTextureCache(directory),
                log: message => GonogoLog.Info("bodies", message));
            _source = engine.RegisterKeptNamespace(BodyTextureWire.Prefix, new ChannelDeclaration
            {
                Kind = SampleKind.Discrete,
                Requires = Requirement.None,
                Delivery = Delivery.LossyLatest,
                /* A body's map is the same wherever it is read from, so no command centre waits for it. */
                Delay = DelayRole.TrueNow,
                Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
                OpaquePayload = true,
            });
            _source.OnSubscribed(topic =>
            {
                if (BodyTextureWire.TryParseKey(topic.Substring(BodyTextureWire.Prefix.Length), out var body))
                {
                    _server.Ask(body);
                }
            });
        }

        /// <summary>
        /// MAIN-THREAD, once per rendered frame in every scene: moves each
        /// asked-for map on a step and keeps the ones now ready, which sends each
        /// to every connection subscribed to its body.
        /// </summary>
        internal void UpdateOnMain()
        {
            if (_server == null || _source == null)
            {
                return;
            }
            foreach (var map in _server.Tick(Time.realtimeSinceStartup))
            {
                _source.KeepFromAnyThread(BodyTextureWire.Key(map.Body), map.Png == null ? Array.Empty<byte[]>() : new[] { map.Png });
            }
        }
    }
}
