import { prepareSessionContext } from '../src/cvd-session-context-artifact.mjs';
try { console.log(JSON.stringify(prepareSessionContext(process.argv[2] === 'none' ? null : process.argv[2],process.argv[3]))); }
catch(e) { console.error(e.message); process.exitCode = 1; }
