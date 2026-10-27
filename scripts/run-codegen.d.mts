export interface CodegenStep {
  label: string;
  command: string;
  args: string[];
  outputs: string[];
}

export const CODEGEN_STEPS: CodegenStep[];
