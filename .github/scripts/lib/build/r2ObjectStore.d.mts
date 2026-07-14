import type { S3Client } from '@aws-sdk/client-s3';
import type { ObjectStore } from '../../../../shared/data/build/receiptStore';

/** Build an ObjectStore over an R2 bucket (create-only immutable writes). */
export declare function createR2ObjectStore(client: S3Client, bucket: string): ObjectStore;
