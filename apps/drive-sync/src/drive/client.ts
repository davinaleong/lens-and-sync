import { createDriveAuthClient } from "../auth/index.js";
import { config } from "../config.js";
import { createDriveClient } from "./index.js";

const auth = createDriveAuthClient(config.GOOGLE_SERVICE_ACCOUNT_EMAIL, config.GOOGLE_SERVICE_ACCOUNT_KEY_FILE);

export const driveClient = createDriveClient(auth);
