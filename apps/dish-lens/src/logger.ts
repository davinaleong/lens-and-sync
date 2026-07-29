import { createLogger, type Logger } from "@lens-and-sync/shared-logger";
import { config } from "./config.js";

export const logger: Logger = createLogger({ service: "dish-lens", level: config.LOG_LEVEL });
