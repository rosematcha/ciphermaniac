import type { S3Client } from '@aws-sdk/client-s3';
import type { ObjectStore } from '../../../../shared/data/build/receiptStore';
import type { ConditionalPointerStore } from '../../../../shared/data/build/channel';

/**
 * Build an ObjectStore over an R2 bucket (create-only immutable writes) that
 * also satisfies the conditional pointer store (ETag If-Match / If-None-Match).
 */
export declare function createR2ObjectStore(client: S3Client, bucket: string): ObjectStore & ConditionalPointerStore<unknown>;
