// Importing these modules triggers registerDataSource() for each source.
// Order matters: telemachus + kos register first so the buffered wrapper
// can reference them by name.
import "./telemachus";
import "./kos";
import "./buffered";
