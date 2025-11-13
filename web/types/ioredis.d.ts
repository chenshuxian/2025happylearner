/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "ioredis" {
  // Minimal ambient declaration to avoid TS module resolution errors in environments
  // where ioredis is an optional dependency. Consumers should still install the real
  // package in production/staging.
  const IORedis: any;
  export default IORedis;
  export const MockRedis: any;
}