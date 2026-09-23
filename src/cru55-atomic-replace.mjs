import fs from 'node:fs';
import { assertPlainPath } from './cvd-observation-isolation.mjs';

// The caller has already fsynced the temporary file. Windows sharing contention
// must never be worked around by deleting the last readable target.
export function replaceDurableFileSync(temp,target,{beforeReplace=()=>true}={}){
  const delays=[25,50,100,200,400];
  for(let attempt=0;;attempt++){
    assertPlainPath(temp);assertPlainPath(target);
    if(beforeReplace()===false)return false;
    try{fs.renameSync(temp,target);return true;}
    catch(error){
      if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt===delays.length)throw error;
      // This pipeline is synchronous; its current prefix protection remains
      // owned throughout the bounded wait. Revalidate again before visibility.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,delays[attempt]);
    }
  }
}
