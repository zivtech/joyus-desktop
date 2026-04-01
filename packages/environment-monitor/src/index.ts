export { createProboDetector } from "./proboDetector.js";
export type { ProboDetector } from "./proboDetector.js";

export {
  openRemoteEnvironmentStore,
  mapRowToRemoteEnvironment,
} from "./remoteEnvironmentStore.js";
export type {
  EnvironmentType,
  RemoteEnvironmentStatus,
  RemoteEnvironment,
  RemoteEnvironmentStore,
} from "./remoteEnvironmentStore.js";

export { createUserIdentity } from "./userIdentity.js";
export type { UserType, UserIdentity, UserIdentityDeps } from "./userIdentity.js";

export {
  createProjectDiscovery,
  normalizeRepoUrl,
} from "./projectDiscovery.js";
export type {
  DiscoveredProject,
  ProjectDiscovery,
  ProjectDiscoveryDeps,
} from "./projectDiscovery.js";

export {
  createDeploymentStatusPoller,
  mapGitHubStateToStatus,
} from "./deploymentStatusPoller.js";
export type {
  ExecCommand,
  DeploymentStatusPollerDeps,
  PollResult,
  DeploymentStatusPoller,
} from "./deploymentStatusPoller.js";

export { openActivityLog } from "./activityLog.js";
export type {
  ActivityEventType,
  ActivityLogEntry,
  ActivityLog,
} from "./activityLog.js";

export { createEnvironmentMonitor } from "./environmentMonitor.js";
export type {
  EnvironmentMonitor,
  EnvironmentMonitorDeps,
} from "./environmentMonitor.js";
