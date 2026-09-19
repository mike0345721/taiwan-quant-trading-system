import { prepareCvdRelationship } from '../src/cvd-relationship-artifact.mjs';
try { console.log(JSON.stringify(prepareCvdRelationship(process.argv[2], process.argv[3]))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
