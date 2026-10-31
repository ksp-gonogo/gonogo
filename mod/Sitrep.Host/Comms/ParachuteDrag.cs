namespace Sitrep.Host.Comms
{
    /// <summary>
    /// How hard the parachutes on a craft can slow it, worked out the way the game
    /// works a canopy's drag: its drag multiplier times the canopy's drag
    /// coefficient and mass, over the craft's mass, as a force in kN.
    /// </summary>
    public static class ParachuteDrag
    {
        /// <summary>The factor from the game's drag multiplier to a force in kN per unit of half air density times speed squared, in tonnes. Held to the stock Mk16's terminal speed by a test.</summary>
        public const double ForceUnit = 1e-3;

        /// <param name="dragMultiplier">The game's global drag multiplier.</param>
        /// <param name="canopyDragMass">Each canopy's fully deployed drag coefficient times its mass, in tonnes, summed.</param>
        /// <param name="vesselMass">The craft's mass, in tonnes.</param>
        /// <returns>The acceleration the canopies give the craft fully open, in m/s², per unit of half the air density times the speed squared.</returns>
        public static double PerPressure(double dragMultiplier, double canopyDragMass, double vesselMass) =>
            dragMultiplier * ForceUnit * canopyDragMass / vesselMass;

        /// <summary>The speed at which the canopies fully open hold a craft against <paramref name="gravity"/> in air of <paramref name="density"/> kg/m³, in m/s.</summary>
        public static double TerminalSpeed(double perPressure, double density, double gravity) =>
            System.Math.Sqrt(2.0 * gravity / (density * perPressure));
    }
}
