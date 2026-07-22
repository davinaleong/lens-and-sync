// TODO: per-user rate limiting (express-rate-limit + rate-limit-redis store).
// NSFW/inappropriate content check reads the SafeSearch annotation already
// returned by vision/index.ts - report/block/delete mechanisms for saved
// chats and images live here too.
export {};
