using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// KSP-free vehicle for the per-kerbal EVA topics, mirroring how the vessel
    /// Uplink wires <c>eva.kerbal.&lt;vessel id&gt;.state</c>: the production namespace
    /// declaration and the production <see cref="EvaKerbalPublications"/>, with each
    /// kerbal's own link reported the way the fleet Uplink reports every craft's.
    ///
    /// <para>A snapshot drives it through <c>evaCrew</c> (the roster the vessel Uplink
    /// reads off the game) and <c>kerbalLinks</c> (a dictionary of kerbal vessel id to
    /// connected).</para>
    /// </summary>
    internal sealed class EvaKerbalTestUplink : ISitrepUplink
    {
        private IDynamicChannelSource? _kerbals;
        private IUplinkHost? _host;
        private readonly EvaKerbalPublications _publications = new EvaKerbalPublications();

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "eva-kerbal-test",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>(),
        };

        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            _host = host;
            _kerbals = host.RegisterDynamicNamespace(VesselViewProvider.EvaKerbalPrefix, new ChannelDeclaration
            {
                Kind = SampleKind.Discrete,
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                PerVesselNode = true,
            });
            host.AddSampledSource(snapshot => snapshot, Handle);
        }

        private void Handle(object? captured)
        {
            if (captured is not KspSnapshot snapshot || _kerbals == null || _host == null)
            {
                return;
            }

            if (snapshot.Values.TryGetValue("kerbalLinks", out var raw)
                && raw is IDictionary<string, bool> links)
            {
                foreach (var link in links)
                {
                    _host.SetVesselConnectivity(link.Key, link.Value);
                }
            }

            foreach (var publication in _publications.Next(snapshot))
            {
                _kerbals.Publisher(publication.SubTopic).Publish(publication.Payload, snapshot.Ut);
            }
        }
    }
}
