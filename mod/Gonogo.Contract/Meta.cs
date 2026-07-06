using Reinforced.Typings.Attributes;

namespace Gonogo.Contract;

[TsEnum] public enum Quality { OnRails, Loaded }
[TsEnum] public enum Staleness { Fresh, HeldStale, LastBeforeBlackout }

[TsInterface]
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
