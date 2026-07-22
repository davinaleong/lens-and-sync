import express from "express";
import helmet from "helmet";
import { syncRouter } from "./routes/sync.js";

const app = express();
const port = process.env.PORT ?? 4001;

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/sync", syncRouter);

app.listen(port, () => {
  console.log(`drive-sync listening on :${port}`);
});
