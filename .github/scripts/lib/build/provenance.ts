import { canonicalStringify } from '../../../../shared/data/canonicalJson';
import { sha256HexString } from '../../../../shared/data/hash';

export interface ProducerState {
  status: 'building' | 'complete';
  inputs: string;
  revision: string;
}

export function inputFingerprint(value: unknown): string {
  return sha256HexString(canonicalStringify(value));
}

export function assertProducerComplete(state: ProducerState | null, inputs: string, label: string): void {
  if (!state || state.status !== 'complete' || state.inputs !== inputs) {
    throw new Error(`${label} has no completed generation for the selected inputs; run its producer before publishing`);
  }
}
