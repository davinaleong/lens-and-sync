import express from "express";
import helmet from "helmet";
import { uploadRouter } from "./routes/upload.js";
import { historyRouter } from "./routes/history.js";

const app = express();
const port = process.env.PORT ?? 4002;

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/upload", uploadRouter);
app.use("/chats", historyRouter);

app.listen(port, () => {
  console.log(`dish-lens listening on :${port}`);
});
