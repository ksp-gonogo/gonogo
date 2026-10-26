using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// KSP-free vehicle for the per-kerbal EVA topics, mirroring how the vessel
    /// Uplink wires <c>eva.kerbal.&lt;vessel id&gt;.state</c>: the production namespace
    /// declaration and the production <see cref="EvaKerbalPublications"/>.
    ///
    /// <para>A snapshot drives it through <c>evaCrew</c>, the roster the vessel Uplink
    /// reads off the game.</para>
    /// </summary>
    internal sealed class EvaKerbalTestUplink : ISitrepUplink
    {
        private IDynamicChannelSource? _kerbals;
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
            _kerbals = host.RegisterDynamicNamespace(VesselViewProvider.EvaKerbalPrefix, new ChannelDeclaration
            {
                Kind = SampleKind.Discrete,
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            });
            host.AddSampledSource(snapshot => snapshot, Handle);
        }

        private void Handle(object? captured)
        {
            if (captured is not KspSnapshot snapshot || _kerbals == null)
            {
                return;
            }

            foreach (var publication in _publications.Next(snapshot))
            {
                _kerbals.Publisher(publication.SubTopic).Publish(publication.Payload, snapshot.Ut);
            }
        }
    }
}
