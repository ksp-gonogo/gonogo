#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

#if NETSTANDARD2_0
[TsEnum]
#endif
public enum Quality { OnRails, Loaded }

#if NETSTANDARD2_0
[TsEnum]
#endif
public enum Staleness { Fresh, HeldStale, LastBeforeBlackout }

#if NETSTANDARD2_0
[TsInterface]
#endif
public class Meta
{
    public string Source { get; set; } = "";
    public double ValidAt { get; set; }
    public long Seq { get; set; }
    public double DeliveredAt { get; set; }
    public string Vantage { get; set; } = "";
    public Quality Quality { get; set; }
    public bool Active { get; set; }
    public Staleness Staleness { get; set; }
    public double? Confidence { get; set; }
}
