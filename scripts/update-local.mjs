import path from 'node:path';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline/promises';
import fs from 'node:fs';
import {readJson,validateUpdatePlan,runLocalUpdate} from '../src/cru55-local-update.mjs';
import {createWindowsUpdateDriver} from '../src/cru55-local-update-windows.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
try {
  if(process.argv.length!==3)throw Error('用法：node scripts/update-local.mjs <私人計畫.json>');
  const plan=validateUpdatePlan(readJson(path.resolve(process.argv[2])),root);
  const driver=createWindowsUpdateDriver(root),route=path.join(plan.stateRoot,'active.json'),previous=fs.existsSync(route)?readJson(route):null;
  await driver.preflight(plan,previous);
  console.log(`本機更新（隔離候選）\n目前實際載入版本：${previous?.head??'尚未啟動隔離候選'}\n已批准來源主線：${plan.approvedMainSha}\n本次驗證目標：${plan.targetSha}\n決策來源：${plan.decisionUrl}\n範圍：${plan.stateRoot}\n端口：${plan.port}\n正式啟用：不允許；保留UI、登入及現有資料接線`);
  const prompt=readline.createInterface({input:process.stdin,output:process.stdout});
  const answer=await prompt.question('請一次確認上述隔離目標，輸入完整目標SHA（其餘階段自動進行）：');prompt.close();
  const result=await runLocalUpdate(plan,{driver,confirm:answer.trim(),onStage:s=>console.log(`[${s.name}] ${s.result}${s.reason?'：'+s.reason:''}`)});
  console.log(`結果：${result.result}；正式切換及全天可用均未宣稱。`);
} catch(e) {console.error(`更新未完成：${e.message}`);process.exitCode=1;}
