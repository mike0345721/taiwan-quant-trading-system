import { materializeCvdBatch } from '../src/cru55-dynamic-materializer.mjs';
import { prepareDynamicProjection } from '../src/cru55-dynamic-projection.mjs';
const [sourcePath,runId,stop,priorRunId]=process.argv.slice(2);
try{
  const result=materializeCvdBatch({sourcePath,runId,stopOrdinal:stop?Number(stop):null,maxRecords:1000});
  const projection=prepareDynamicProjection(runId,priorRunId);
  console.log(JSON.stringify({state:result.state,processedRecords:result.processedRecords,...projection}));
}catch(e){console.error(JSON.stringify({state:'BLOCKED',reason:e.message}));process.exitCode=1;}
