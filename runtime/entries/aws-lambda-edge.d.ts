import type { Context, CloudFrontRequestEvent, CloudFrontResultResponse } from 'aws-lambda';
import '#internal/nitro/virtual/polyfill';
export declare const handler: (event: CloudFrontRequestEvent, context: Context) => Promise<CloudFrontResultResponse>;
