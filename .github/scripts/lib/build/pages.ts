import { resolvedAttempt } from './deploymentLifecycle';
import ts from 'typescript';
import { requireEnv } from '../env';
import { type ReleaseManifest } from '../../../../shared/data/build/release';
import { type DeploymentAttempt, type PagesDeployment, type PagesReader, validatedManifest } from './deployment';

interface ApiDeployment {
  id: string;
  url: string;
  environment: string;
  created_on: string;
  latest_stage: { name: string; status: string };
  deployment_trigger?: { type?: string; metadata?: { commit_message?: string } };
}

function deployment(value: ApiDeployment): PagesDeployment {
  const { id, url } = value;
  if (typeof id !== 'string' || !id || !/^https:\/\/[a-zA-Z0-9-]+\.ciphermaniac\.pages\.dev$/.test(url)) {
    throw new Error('Invalid Pages deployment identity');
  }
  const status = deploymentStatus(value.latest_stage);
  const message = value.deployment_trigger?.metadata?.commit_message ?? '';
  return {
    id,
    url,
    status,
    attemptId: /^ciphermaniac:([\w-]+)$/.exec(message)?.[1],
    createdAt: value.created_on,
    adHoc: value.deployment_trigger?.type === 'ad_hoc'
  };
}

function deploymentStatus(stage: ApiDeployment['latest_stage']): string {
  if (!stage || !['success', 'failure', 'canceled', 'skipped', 'active', 'idle'].includes(stage.status)) {
    throw new Error('Unknown Pages deployment status');
  }
  const terminal = stage.name === 'deploy' || ['failure', 'canceled', 'skipped'].includes(stage.status);
  return terminal ? stage.status : 'active';
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`Pages read failed: HTTP ${response.status}`);
  }
  return response.json();
}

function propertyName(name: ts.PropertyName): string {
  return ts.isStringLiteral(name) ? name.text : name.getText();
}

/** Reads literal objects only; never executes downloaded deployment JavaScript. */
function literal(node: ts.Node): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)) {
    return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
  }
  if (!ts.isObjectLiteralExpression(node)) {
    throw new Error('Nonliteral embedded manifest');
  }
  const entries = node.properties.map(property => {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error('Nonliteral manifest property');
    }
    const name = propertyName(property.name);
    return [name, literal(property.initializer)];
  });
  return Object.fromEntries(entries);
}

export function legacyManifest(source: string): ReleaseManifest | null {
  const file = ts.createSourceFile('release.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let found: ReleaseManifest | null = null;
  function visit(node: ts.Node): void {
    if (
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(property => property.name && propertyName(property.name) === 'contractVersion')
    ) {
      found = validatedManifest(literal(node));
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

async function deployedManifest(deployed: PagesDeployment, request: typeof fetch): Promise<ReleaseManifest> {
  const response = await request(`${deployed.url}/deployment-release.json`, { cache: 'no-store' });
  // Old deployments have no marker (Pages may return the SPA HTML with HTTP 200).
  if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
    const marker = (await response.json()) as { manifest?: unknown; attemptId?: unknown };
    if (marker.attemptId !== deployed.attemptId || typeof marker.attemptId !== 'string') {
      throw new Error('Pages deployment marker and attempt identity disagree');
    }
    return validatedManifest(marker.manifest);
  }
  if (!response.ok && response.status !== 404) {
    throw new Error(`Pages manifest read failed: HTTP ${response.status}`);
  }
  const htmlResponse = await request(`${deployed.url}/`, { cache: 'no-store' });
  if (!htmlResponse.ok) {
    throw new Error('Cannot inspect legacy Pages application');
  }
  const html = await htmlResponse.text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[\w-]+\.js)"/g)].map(match => match[1]))];
  for (const asset of assets) {
    const body = await request(`${deployed.url}${asset}`, { cache: 'no-store' });
    if (!body.ok) {
      throw new Error('Cannot read legacy Pages bundle');
    }
    const manifest = legacyManifest(await body.text());
    if (manifest) {
      return manifest;
    }
  }
  throw new Error('Cannot reconcile deployed release');
}

type PagesApi = (path: string) => Promise<{ result: unknown; result_info?: { total_pages?: number } }>;

function inventoryPage(value: Awaited<ReturnType<PagesApi>>): { deployments: PagesDeployment[]; totalPages: number } {
  if (!Array.isArray(value.result) || !Number.isInteger(value.result_info?.total_pages)) {
    throw new Error('Incomplete Pages deployment inventory');
  }
  const totalPages = value.result_info!.total_pages!;
  if (totalPages < 1 || totalPages > 1000) {
    throw new Error('Pages deployment inventory exceeds safety bound');
  }
  const deployments = (value.result as ApiDeployment[])
    .filter(item => item.environment === 'production')
    .map(deployment);
  return { deployments, totalPages };
}

async function inspectInventory(
  api: PagesApi,
  attempts: Record<string, DeploymentAttempt>,
  deployed: PagesDeployment
): Promise<PagesDeployment[]> {
  const pending = new Map(Object.entries(attempts).filter(([, attempt]) => !resolvedAttempt(attempt)));
  if (deployed.attemptId) {
    pending.delete(deployed.attemptId);
  }
  const oldest = Math.min(...[...pending.values()].map(attempt => Date.parse(attempt.startedAt)));
  const deployments: PagesDeployment[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    const batch = inventoryPage(await api(`/deployments?env=production&page=${page}&per_page=25`));
    ({ totalPages } = batch);
    deployments.push(...batch.deployments);
    for (const item of batch.deployments) {
      if ((item.attemptId || item.adHoc) && ['active', 'idle'].includes(item.status)) {
        throw new Error('Pages has an unresolved production deployment');
      }
      if (item.attemptId) {
        pending.delete(item.attemptId);
      }
    }
    if (pending.size === 0 || olderThanAttempts(batch.deployments, oldest)) {
      break;
    }
  }
  return deployments;
}

function olderThanAttempts(deployments: PagesDeployment[], oldest: number): boolean {
  const times = deployments.map(item => Date.parse(item.createdAt ?? ''));
  if (times.some(time => !Number.isFinite(time))) {
    throw new Error('Missing Pages deployment creation time');
  }
  return times.length > 0 && Math.min(...times) < oldest;
}

export function createPagesReader(accountId: string, token: string, request: typeof fetch = fetch): PagesReader {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/ciphermaniac`;
  async function api(path: string): Promise<{ result: unknown; result_info?: { total_pages?: number } }> {
    const value = (await responseJson(
      await request(`${base}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000)
      })
    )) as { success?: boolean; result: unknown; result_info?: { total_pages?: number } };
    if (value.success !== true) {
      throw new Error('Pages API could not reconcile production');
    }
    return value;
  }
  return {
    async inspect(attempts = {}) {
      const project = (await api('')).result as { canonical_deployment: ApiDeployment };
      const deployed = deployment(project.canonical_deployment);
      if (project.canonical_deployment.environment !== 'production' || deployed.status !== 'success') {
        throw new Error('Pages production is not a successful deployment');
      }
      const deployments = await inspectInventory(api, attempts, deployed);
      return { deployed, deployments };
    },
    manifest: deployed => deployedManifest(deployed, request)
  };
}

export function pagesReaderFromEnv(): PagesReader {
  return createPagesReader(requireEnv('CLOUDFLARE_ACCOUNT_ID'), requireEnv('CLOUDFLARE_API_TOKEN'));
}
