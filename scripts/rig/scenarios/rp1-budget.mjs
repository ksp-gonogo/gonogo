/**
 * RP-1's own Budget tab at Day, Month and Year, its funds and reputation
 * tooltips, and the Facilities, Astronauts and Programs breakdowns, each
 * captured beside `rp1.budget` and `rp1.budgetBreakdown` as the wire held them.
 *
 * Needs an RP-1 career loaded at the Space Center with RP-1's window open on
 * its Budget tab (the RP-1 toolbar button). The breakdowns are reached by the
 * small buttons beside Facilities, Astronauts and Program Budget. Run with
 * `--no-app`: the comparison is the game's window against the Topic payloads in
 * each capture's JSON.
 */
const PERIOD = {
  Day: "click 629 357",
  Month: "click 717 357",
  Year: "click 806 357",
};
const BUDGET_TAB = "click 556 293";

/**
 * Each breakdown's button on the Budget tab, and its own Day, Month and Year
 * buttons, which sit differently per breakdown.
 */
const BREAKDOWN = {
  facilities: { open: "click 845 387", periods: [667, 730, 796] },
  astronauts: { open: "click 845 465", periods: [680, 750, 824] },
  programs: { open: "click 845 595", periods: [676, 736, 797] },
};

export default {
  name: "rp1-budget",
  topics: ["rp1.budget", "rp1.budgetBreakdown", "career.status"],
  steps: [
    { name: "budget", wait: "rp1.budget", timeoutS: 60 },
    { wait: "rp1.budgetBreakdown", timeoutS: 60 },
    ...Object.entries(PERIOD).flatMap(([period, click]) => [
      { name: `period-${period}`, input: `${click}; sleep 1.5` },
      { capture: `budget-${period.toLowerCase()}` },
    ]),
    { input: `${PERIOD.Day}; sleep 1` },
    { name: "funds-tooltip", input: "move 545 17; sleep 2" },
    { capture: "tooltip-funds" },
    { name: "reputation-tooltip", input: "move 700 17; sleep 2" },
    { capture: "tooltip-reputation" },
    ...Object.entries(BREAKDOWN).flatMap(([tab, { open, periods }]) => [
      {
        name: `breakdown-${tab}`,
        input: `${BUDGET_TAB}; sleep 1.5; ${open}; sleep 2`,
      },
      ...["day", "month", "year"].flatMap((period, i) => [
        { input: `click ${periods[i]} 357; sleep 1.5` },
        { capture: `breakdown-${tab}-${period}` },
      ]),
    ]),
    { input: `${BUDGET_TAB}; sleep 1` },
  ],
};
