'use strict';
const $=id=>document.getElementById(id);
let csrf='',poll,last=null,working=false,stopped=false;
const labels={PREPARING_AUTHORIZATION:'正在連接官方登入服務…',AUTHORIZATION_REQUIRED:'等待本人登入授權',WAITING_FOR_OWNER_SIGN_IN:'等待官方登入與同意',VALIDATING_AUTHORIZATION:'正在驗證官方授權',AUTHORIZED_MODEL_NOT_TESTED:'帳號已授權；模型尚未測試',IDENTITY_ONLY_PLAN_NOT_GRANTED:'已確認身分，但沒有取得方案用量權限',MODEL_SELECTION_READY:'模型清單已取得；等待你選擇測試',MODEL_TEST_RUNNING:'正在發出一次模型連線測試',CONNECTIVITY_PROBE_COMPLETED:'真實模型連線測試完成（不是原面板交付）',AUTHORIZATION_CANCELLED:'這次登入已取消',AUTHORIZATION_EXPIRED:'這次登入已逾時，請重新登入',AUTHORIZATION_FAILED:'授權驗證失敗',REQUEST_FAILED:'這次操作失敗',SETUP_EXPIRED:'驗證入口已到期',SETUP_STOPPED:'驗證入口已關閉'};
const errors={UPSTREAM_TLS_UNTRUSTED:'無法驗證官方登入服務的安全憑證，已停止。請回報此錯誤，不需修改密碼或啟用額外付費。',UPSTREAM_CONNECTION_FAILED:'目前無法連到官方登入服務，沒有發出模型請求。請稍後再按登入。',REQUEST_TIMED_OUT:'官方服務連線逾時，這次操作未完成；不會自動重試或切換付費 API。',REQUEST_FAILED:'登入準備失敗，尚未進入官方授權；請回報目前狀態，不必反覆點擊。',SETUP_SESSION_REQUIRED:'此頁沒有有效的本機驗證工作階段，請由啟動入口重新開啟。',SETUP_LINK_EXPIRED_OR_USED:'此啟動連結已過期或已使用；請重新啟動驗證入口。',PLAN_PERMISSION_NOT_GRANTED:'官方回傳未包含方案用量權限，不會發出模型請求。',CREDITS_SETTING_CONFIRMATION_REQUIRED:'請先確認 ChatGPT 沒有允許 Apps 使用額外 credits。',REAUTHORIZE_REQUIRED:'授權已過期，需重新登入，不會偷偷改用付費 API。',PLAN_USAGE_LIMIT_REACHED:'方案額度或應用程式限制已達上限，已停止。',PLAN_USAGE_UNAVAILABLE:'此帳號目前無法提供方案用量，已停止。',PROBE_ALREADY_USED:'本次入口只允許一次模型測試，已停止重複請求。',STREAM_INTERRUPTED:'模型串流沒有完整完成，不能視為成功。',AUTHORIZATION_DECLINED:'你未授權這次連線，沒有發出模型請求。',AUTH_STATE_MISMATCH:'授權回傳和這次工作階段不一致，已拒絕。'};
function notice(code){$('notice').textContent=errors[code]||`操作未完成：${code}`;$('notice').scrollIntoView?.({block:'nearest'});}
async function call(route,body){
 const response=await fetch(route,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(route==='/api/probe'?70000:25000)});
 const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'REQUEST_FAILED');return result;
}
function choices(node,items,empty){
 const signature=JSON.stringify(items);if(node.dataset.signature===signature)return;
 const prior=node.value;node.replaceChildren(new Option(empty,''));for(const item of items)node.add(new Option(item.label,item.key));
 if(items.some(item=>item.key===prior))node.value=prior;node.dataset.signature=signature;
}
function controls(){
 const busy=working||last?.busy||stopped;
 $('connect').disabled=!csrf||busy||Boolean(last?.probeAttempted);
 $('cancel').disabled=!csrf||busy||last?.phase!=='WAITING_FOR_OWNER_SIGN_IN';
 $('models').disabled=!csrf||busy||!last?.directPermission||Boolean(last?.probeAttempted);
 $('model').disabled=busy||!last?.models?.length||Boolean(last?.probeAttempted);
 $('probe').disabled=!csrf||busy||!last?.directPermission||Boolean(last?.probeAttempted)||!$('credits').checked||!$('model').value;
 $('stop').disabled=!csrf||busy;
}
async function refresh(){
 if(stopped)return;
 try{
  const data=await call('/api/status');last=data;csrf=data.csrf;
  $('status').textContent=labels[data.phase]||data.phase;
  $('detail').textContent=data.reason?(errors[data.reason]||data.reason):'';
  $('deadline').textContent=`最後更新：${new Date(data.updatedAt).toLocaleTimeString('zh-TW')}｜本次入口到期：${new Date(data.expiresAt).toLocaleTimeString('zh-TW')}`;
  $('active').textContent=data.activeLabel?`已驗證帳號：${data.activeLabel}；方案用量權限：${data.directPermission?'已取得，仍需完成模型測試':'未取得'}`:'尚未驗證帳號。';
  choices($('account'),data.accounts||[],'新增 ChatGPT 帳號或工作區');
  choices($('model'),(data.models||[]).map(m=>({key:m.slug,label:m.display_name})),'請選擇本次測試模型');
  if(data.result){$('answer').textContent=data.result.text;$('model-result').textContent=`模型：${data.result.model||'由供應商回傳'}｜完成事件：${data.result.terminal}｜用量路徑：ChatGPT 訂閱授權；未啟用 API Key 備援。`;}
  controls();
 }catch(error){stopped=true;clearInterval(poll);$('status').textContent='連線驗證入口已停止或無法連線';notice(error.name==='TimeoutError'?'REQUEST_TIMED_OUT':error.message);controls();}
}
async function action(fn){if(working||stopped)return;working=true;$('notice').textContent='';controls();try{await fn();}catch(error){notice(error.name==='TimeoutError'?'REQUEST_TIMED_OUT':error.message);}finally{working=false;if(!stopped)await refresh();else controls();}}
$('connect').addEventListener('click',()=>action(async()=>{$('status').textContent='正在連接官方登入服務…';const result=await call('/api/authorize',{registration:$('account').value});const url=new URL(result.authorizationUrl);if(url.origin!=='https://auth.openai.com'||url.pathname!=='/api/accounts/authorize')throw new Error('AUTH_URL_REJECTED');location.assign(url.href);}));
$('cancel').addEventListener('click',()=>action(()=>call('/api/cancel',{})));
$('models').addEventListener('click',()=>action(()=>call('/api/models',{})));
$('probe').addEventListener('click',()=>action(()=>call('/api/probe',{model:$('model').value,creditsDisabledConfirmed:$('credits').checked})));
$('credits').addEventListener('change',controls);$('model').addEventListener('change',controls);
$('stop').addEventListener('click',()=>action(async()=>{await call('/api/stop',{});stopped=true;clearInterval(poll);$('status').textContent='本次驗證入口已關閉；正式行情服務不受影響。';}));
(async()=>{
 try{const capability=location.hash.slice(1);history.replaceState(null,'','/');if(capability)await call('/api/bootstrap',{capability});await refresh();if(!stopped)poll=setInterval(()=>{void refresh();},2000);}
 catch(error){stopped=true;notice(error.message);$('status').textContent='尚未建立驗證工作階段';controls();}
})();
