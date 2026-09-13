import { createApp } from './app.js';
import { closeAppDeps, createAppDeps } from './deps.js';

function main(): void {
  const deps = createAppDeps();
  const app = createApp(deps);

  const server = app.listen(deps.env.apiPort, () => {
    deps.logger.info({ port: deps.env.apiPort }, 'apps/api listening');
  });

  const shutdown = (): void => {
    server.close();
    closeAppDeps(deps).catch((error: unknown) => {
      deps.logger.error({ err: error }, 'Error while closing app dependencies during shutdown');
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
