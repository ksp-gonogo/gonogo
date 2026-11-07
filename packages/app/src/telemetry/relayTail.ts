/**
 * Seconds of each topic, at one sample a second and that many times more for a
 * topic sent faster, the main screen replays to a station that subscribes late.
 * Anything older a chart draws is asked for over the history request, answered
 * from the main screen's own timeline, so the relay keeps no second run of it.
 */
export const RELAY_TAIL_PER_TOPIC = 60;
