namespace Gonogo.KSP
{
    /// <summary>
    /// The Gonogo section of a save's difficulty settings, shown beside the
    /// stock CommNet options when a game is created and in the Difficulty
    /// settings of a game in progress. Holds the signal delay choice, so it
    /// belongs to the save.
    /// </summary>
    public sealed class GonogoGameParameters : GameParameters.CustomParameterNode
    {
        [GameParameters.CustomParameterUI("Signal delay",
            toolTip = "Commands and readings take the time light needs to cross the distance. "
                + "Off, they arrive at once; a craft with no path is still out of contact")]
        public bool signalDelay = true;

        [GameParameters.CustomFloatParameterUI("Light speed",
            minValue = (float)SignalDelayChoice.MinLightSpeedScale,
            maxValue = (float)SignalDelayChoice.MaxLightSpeedScale,
            addTextField = true,
            displayFormat = "0.############",
            toolTip = "How fast signals travel, as a fraction of the speed of light. "
                + "1 is real light speed and 0.5 doubles every delay. Any value from 0.00000001 to 100")]
        /*
         * Typed, not dragged: the slider KSP draws beside the field is linear, so it
         * cannot reach the small end. A log scale is not an option because KSP reads
         * the typed text as the exponent when logBase is set. The format has to keep
         * a value like 0.00000001 intact, since KSP rounds every committed value
         * through it (F2 would store 0).
         */
        public float lightSpeedScale = 1f;

        public override string Title => "Signal delay";

        public override string DisplaySection => "Gonogo";

        public override string Section => "Gonogo";

        public override int SectionOrder => 1;

        public override GameParameters.GameMode GameMode => GameParameters.GameMode.ANY;

        public override bool HasPresets => false;
    }
}
