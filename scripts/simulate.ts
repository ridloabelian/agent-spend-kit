import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { AgentSpendClient } from '../packages/sdk/src/index.js';
import { createApp, resetDatabaseTables } from '../packages/server/src/index.js';
import { runThreeAgentSimulation } from '../packages/server/src/simulation/scenario.js';

async function main() {
  const externalUrl = process.env.AGENT_SPEND_API_URL;
  let serverInstance: ReturnType<typeof createApp> | null = null;
  let httpServer: ReturnType<typeof serve> | null = null;
  let targetUrl = externalUrl ?? '';

  try {
    if (!externalUrl) {
      const dbPath = process.env.DATABASE_PATH ?? './data/agent-spend.db';
      serverInstance = createApp({ databasePath: dbPath });
      resetDatabaseTables(serverInstance.dbConn.sqlite);

      await new Promise<void>((resolve) => {
        httpServer = serve(
          {
            fetch: serverInstance!.app.fetch,
            port: 0,
            hostname: '127.0.0.1'
          },
          (info: AddressInfo) => {
            targetUrl = `http://127.0.0.1:${info.port}`;
            resolve();
          }
        );
      });
    }

    console.log(`\n🚀 Running agent-spend-kit 3-agent simulation against ${targetUrl}\n`);
    const client = new AgentSpendClient({ baseUrl: targetUrl });
    const summary = await runThreeAgentSimulation(client);

    for (const step of summary.steps) {
      console.log(
        `  [${step.agentId.padEnd(14)}] ${step.action.padEnd(46)} -> ${step.outcome.padEnd(20)} | ${step.details}`
      );
    }

    const s = summary.overviewSummary;
    console.log('\n📊 Simulation Complete — Ledger Summary');
    console.log('────────────────────────────────────────────────────────────────────────');
    console.log(`  Agents:            ${s.totalAgents} total (${s.activeAgents} active, ${s.frozenAgents} frozen)`);
    console.log(`  Total Envelope:    $${(s.totalEnvelopeCents / 100).toFixed(2)}`);
    console.log(`  Committed Spend:   $${(s.totalCommittedCents / 100).toFixed(2)}`);
    console.log(`  Settled Spend:     $${(s.totalSettledCents / 100).toFixed(2)}`);
    console.log(`  Pending Approvals: ${s.pendingApprovalCount}`);
    console.log(
      `  Receipts:          ${s.receiptMatchedCount} matched | ${s.receiptMismatchCount} mismatch | ${s.receiptMissingCount} missing | ${s.receiptPendingCount} pending`
    );
    console.log('────────────────────────────────────────────────────────────────────────\n');
  } finally {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
    if (serverInstance) {
      serverInstance.close();
    }
  }
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
