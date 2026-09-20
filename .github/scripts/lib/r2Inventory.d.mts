import type { _Object, S3Client } from '@aws-sdk/client-s3';

export declare function listR2Objects(client: S3Client, bucket: string, prefix: string): AsyncGenerator<_Object>;
export declare function listR2Keys(client: S3Client, bucket: string, prefix: string): Promise<string[]>;
export declare function deleteR2Keys(client: S3Client, bucket: string, keys: string[]): Promise<number>;
