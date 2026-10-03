import { executeAutonomyRun, controlAutonomyRun, readAutonomyRun } from './runtime/autonomy-supervisor.mjs';

// Only explicit service creation starts this entry point, via an IPC handshake.
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--project' || args[2] !== '--run' || !process.send) throw new Error('Explicit local service launch required.');
const root = args[1], id = args[3];
const stop = () => {
  try { const run = readAutonomyRun(root, id); controlAutonomyRun(root, { runId: id, action: 'cancel', expectedRevision: run.revision }); } catch {}
};
process.on('SIGTERM', stop); process.on('SIGINT', stop);
process.once('message', async message => {
  if (message?.start !== true || Object.keys(message).length !== 1) { process.exitCode = 1; return; }
  try { await executeAutonomyRun(root, id); } catch { process.exitCode = 1; }
  finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
});
