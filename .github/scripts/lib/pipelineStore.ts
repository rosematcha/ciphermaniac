import { createR2Client, putJson, readJson } from './r2.mjs';
import { r2Config } from './env';
import { inputFingerprint, type ProducerState } from './build/provenance';

export function pipelineStore() {
  const config = r2Config();
  const client = createR2Client(config);
  const read = <T>(key: string) => readJson<T>(client, config.bucket, key);
  const write = (key: string, value: unknown) => putJson(client, config.bucket, key, value);
  return { read, write };
}

interface StageStore {
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
}

export async function completedStage(
  store: StageStore,
  name: string,
  options: {
    inputs: unknown;
    revision: string;
    force?: boolean;
    run: () => Promise<void>;
  }
): Promise<boolean> {
  const key = `build/v1/producers/${name}.json`;
  const inputs = inputFingerprint(options.inputs);
  const previous = await store.read<ProducerState>(key);
  if (
    !options.force &&
    previous?.status === 'complete' &&
    previous.inputs === inputs &&
    previous.revision === options.revision
  ) {
    console.log(`[${name}] unchanged; reused completed output`);
    return false;
  }
  const state = { inputs, revision: options.revision };
  await store.write(key, { ...state, status: 'building' });
  await options.run();
  await store.write(key, { ...state, status: 'complete' });
  return true;
}
