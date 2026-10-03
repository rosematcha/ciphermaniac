import type { ReleaseManifest } from '../../../../shared/data/build/release';
import type { ConditionalPointerStore } from '../../../../shared/data/build/channel';

export interface DeploymentAttempt {
  releaseId: string;
  startedAt: string;
  deploymentId?: string;
  status?: string;
  resolvedAt?: string;
}

export interface DeploymentState {
  version: 1;
  candidates: Record<string, string>;
  attempts: Record<string, DeploymentAttempt>;
  pinnedAt?: Record<string, string>;
  deployed?: { deploymentId: string; releaseId: string };
}

export interface DeploymentStore extends ConditionalPointerStore<unknown> {
  get(key: string): Promise<string | null>;
  putIfAbsent(key: string, body: string): Promise<void>;
}

export interface PagesDeployment {
  id: string;
  url: string;
  status: string;
  attemptId?: string;
  createdAt?: string;
  adHoc?: boolean;
}

export interface PagesState {
  deployed: PagesDeployment;
  deployments: PagesDeployment[];
}

export interface PagesReader {
  inspect(attempts?: Record<string, DeploymentAttempt>): Promise<PagesState>;
  manifest(deployment: PagesDeployment): Promise<ReleaseManifest>;
}
