// The master plan §8 example workflows (15-workflows.md).
//
// They live in `@onestop/tool-registry` (`packages/tool-registry/src/workflow-templates.ts`) next
// to the chain rules, so the browser's builder can offer them without importing the server; this
// module is the server side's door onto them.
export { WORKFLOW_TEMPLATES, getWorkflowTemplate } from "@onestop/tool-registry";
