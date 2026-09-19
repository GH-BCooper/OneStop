// Chain validation for the run engine and the API routes (15-workflows.md).
//
// The logic itself lives in `@onestop/tool-registry` (`packages/tool-registry/src/workflows.ts`),
// because it is nothing but registry knowledge and the browser's builder needs the same rules
// without a round trip to the server. This module is the server side's door onto it.
export {
  MAX_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_WORKFLOW_NAME_LENGTH,
  MAX_WORKFLOW_STEPS,
  compatibleTypes,
  describeIssues,
  stepInputTypes,
  stepOutputTypes,
  validateWorkflow,
} from "@onestop/tool-registry";
export type { ValidateWorkflowOptions } from "@onestop/tool-registry";
