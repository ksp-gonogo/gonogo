import { useCallback, useState } from "react";

export function useTrajectoryCount() {
  const [trajectoryCount, setTrajectoryCount] = useState(0);
  const incrementTrajectoryCount = useCallback(() => {
    setTrajectoryCount((c) => c + 1);
  }, []);
  return { trajectoryCount, incrementTrajectoryCount };
}
