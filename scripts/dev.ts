import { spawn } from 'node:child_process';

const children = [
  spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', shell: false }),
  spawn('npm', ['run', 'dev:dashboard'], { stdio: 'inherit', shell: false })
];

function shutdown(signal: NodeJS.Signals) {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

for (const child of children) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      shutdown('SIGTERM');
    }
  });
}
