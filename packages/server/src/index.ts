import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

export { createApp, type AppInstance, type CreateAppOptions } from './app.js';
export { createDatabase, type AppDatabase, type DatabaseConnection } from './db/client.js';
export { PolicyEngine, DomainError } from './domain/policy-engine.js';
export { normalizeVendor, matchesVendorPattern, matchesVendorList } from './domain/vendor-matcher.js';
export { exportLedgerCsv, exportLedgerJson, toLedgerEntries } from './domain/ledger-export.js';
export { SimulatorCardProvider } from './providers/simulator-provider.js';
export { StripeIssuingCardProvider } from './providers/stripe-issuing-provider.js';
export { computeLuhnCheckDigit, generateLuhnNumber, isValidLuhn, formatMaskedPan } from './providers/luhn.js';
export { parseMoneyToCents, formatCents } from './receipts/money.js';
export { parseReceipt } from './receipts/parser.js';
export { ReceiptReconciler } from './receipts/reconciler.js';
export { runThreeAgentSimulation, resetDatabaseTables, createInProcessClient } from './simulation/scenario.js';

export function startServer(): void {
  const port = Number(process.env.PORT ?? 4310);
  const hostname = process.env.HOST ?? '127.0.0.1';
  const instance = createApp();

  const server = serve(
    {
      fetch: instance.app.fetch,
      port,
      hostname
    },
    (info) => {
      console.log(
        `[agent-spend-kit] API server listening on http://${hostname}:${info.port} (provider=${instance.cardProvider.name})`
      );
    }
  );

  const shutdown = () => {
    server.close(() => {
      instance.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  startServer();
}
