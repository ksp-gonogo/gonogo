// Importing these modules triggers registerDataSource() for each source.
// Order matters: telemachus + kos register first so the buffered wrapper
// can reference them by name.
import "./telemachus";
import "./kos";
import { attachKosCaptureToBuffered } from "./buffered";
import "./buffered";

// Pipe the kOS centralised-compute fanout into the buffered store so its
// samples land in the flight history alongside Telemachus telemetry. Done
// at module load (after both sources are registered) so the wiring is in
// place before MainScreen connects either source.
attachKosCaptureToBuffered();
