import { prepareCvdHandoff } from '../src/cvd-handoff-artifact.mjs';
try { console.log(JSON.stringify(prepareCvdHandoff(process.argv[2] === 'none' ? null : process.argv[2],process.argv[3]))); }
catch(e) { console.error(e.message); process.exitCode = 1; }
