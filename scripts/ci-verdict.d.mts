export interface Job {
  name: string;
  conclusion: string | null;
  steps?: { name?: string; conclusion: string | null }[];
}

export interface Grade {
  grade: "green" | "amber" | "red";
  amber: string[];
  red: string[];
  /** The status text, plain ASCII. */
  text: string;
  /** The log line: the text with a coloured mark. */
  label: string;
}

export const STATUS_CONTEXT: string;
export const OWN_JOB: string;
export const AMBER_JOBS: RegExp[];
export function jobFailed(job: Job): boolean;
export function classify(jobs: Job[]): Grade;
export function failsRun(
  grade: Grade["grade"],
  tolerateAmber: boolean,
): boolean;
