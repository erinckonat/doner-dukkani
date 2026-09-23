import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev only: the local game posts its save here so it can be carried over
 * to the published (cloud-saved) version. Written to .local-save.json.
 * A hand-corrected save placed in .save-override.json is handed to the game
 * once on its next load (GET /__save-override), then removed.
 */
function localSaveExport(): Plugin {
  return {
    name: 'local-save-export',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-override', (_req, res) => {
        if (!existsSync('.save-override.json')) { res.statusCode = 204; res.end(); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync('.save-override.json'));
        rmSync('.save-override.json');
      });
      server.middlewares.use('/__save', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            JSON.parse(body);
            writeFileSync('.local-save.json', body);
            res.statusCode = 204;
          } catch {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  // Relative asset paths so the build can be published as a self-contained page.
  base: './',
  server: { port: 5173, host: true },
  plugins: [localSaveExport()],
});
