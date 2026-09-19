import { prepareCvdChart } from '../src/cvd-chart-artifact.mjs';
try { console.log(JSON.stringify(prepareCvdChart(process.argv[2]))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
