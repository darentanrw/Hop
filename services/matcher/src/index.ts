import "dotenv/config";
import { createMatcherApp } from "./app";
import { createLogger } from "./logger";

const port = Number(process.env.MATCHER_PORT ?? 4001);
const logger = createLogger();
const { app } = createMatcherApp({ logger });

app.listen(port, () => {
  logger.info("service.started", {
    port,
    url: `http://localhost:${port}`,
  });
});
