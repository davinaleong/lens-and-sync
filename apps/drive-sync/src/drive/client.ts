import { createDriveAuthClient } from "../auth/index.js";
import { config } from "../config.js";
import { createDriveClient } from "./index.js";

const auth = createDriveAuthClient(config.GOOGLE_CLOUD_CREDENTIALS_JSON);

export const driveClient = createDriveClient(auth);
