import type { WorkflowDefinition } from "../domain/index.js";

function createWorkflowDefinition(
  workflow: Omit<WorkflowDefinition, "operationIds">,
): WorkflowDefinition {
  return {
    ...workflow,
    operationIds: workflow.steps.map((step) => step.operationId),
  };
}

const WORKFLOW_CATALOG: WorkflowDefinition[] = [
  createWorkflowDefinition({
    name: "send_channel_message",
    description: "Post a message to a Rocket.Chat channel.",
    domains: ["messaging"],
    steps: [
      {
        id: "post_message",
        operationId: "post-api-v1-chat_postMessage",
        inputMappings: [],
      },
    ],
  }),
  createWorkflowDefinition({
    name: "create_channel_and_invite_members",
    description: "Create a channel and add members to it.",
    domains: ["rooms", "user-management"],
    steps: [
      {
        id: "create_channel",
        operationId: "post-api-v1-channels_create",
        inputMappings: [],
      },
      {
        id: "invite_members",
        operationId: "post-api-v1-channels_invite",
        inputMappings: [],
      },
    ],
  }),
  createWorkflowDefinition({
    name: "monitor_workspace_statistics",
    description: "Fetch workspace statistics for monitoring and reporting.",
    domains: ["statistics"],
    steps: [
      {
        id: "fetch_statistics",
        operationId: "get-api-v1-statistics",
        inputMappings: [],
      },
    ],
  }),
  createWorkflowDefinition({
    name: "send_alerts_from_statistics",
    description: "Read workspace statistics and send alert messages.",
    domains: ["statistics", "messaging"],
    steps: [
      {
        id: "fetch_statistics",
        operationId: "get-api-v1-statistics",
        inputMappings: [],
      },
      {
        id: "post_alert",
        operationId: "post-api-v1-chat_postMessage",
        inputMappings: [
          {
            targetPath: "requestBody.text",
            sourceStepId: "fetch_statistics",
            sourcePath: "totalUsers",
          },
        ],
      },
    ],
  }),
  createWorkflowDefinition({
    name: "create_and_manage_user",
    description: "Create a user and inspect or update user state.",
    domains: ["user-management"],
    steps: [
      {
        id: "create_user",
        operationId: "post-api-v1-users_create",
        inputMappings: [],
      },
      {
        id: "inspect_user",
        operationId: "get-api-v1-users_info",
        inputMappings: [],
      },
      {
        id: "update_user",
        operationId: "post-api-v1-users_update",
        inputMappings: [],
      },
    ],
  }),
];

export function listWorkflows(): WorkflowDefinition[] {
  return [...WORKFLOW_CATALOG];
}

export function getWorkflowByName(name: string): WorkflowDefinition | undefined {
  return WORKFLOW_CATALOG.find((workflow) => workflow.name === name);
}
