/* Same-page subscription assistant. No model calls on load, reload, or recovery. */
(()=>{'use strict';
 if(document.documentElement.dataset.guestReadOnly==='true')return;
 const $=id=>document.getElementById(id);if(!$('ai-inline'))return;
 const phases={PREPARING_SNAPSHOT:'正在封存目前盤況',CHECKING_SUBSCRIPTION:'正在檢查訂閱與模型',ANALYSING:'模型分析中，回答驗證前暫不顯示',VERIFYING_CONTENT:'正在核對回答與本次盤況',COMPLETED:'回答已通過欄位核對',FAILED:'分析失敗',TIMED_OUT:'分析逾時',CANCELLED:'分析已取消',INTERRUPTED:'上一次分析未確認完成'};
 const reasons={INLINE_ASSISTANT_NOT_ACTIVATED:'本版本尚未啟用原頁分析；下方仍可複製盤況。',AUTH_REQUIRED:'請先登入行情面板，再按「讀取連線狀態」。',SIGN_IN_REQUIRED:'需要連接 ChatGPT 帳號，請按「連接／重新授權」。',REAUTHORIZE_REQUIRED:'訂閱授權需要更新，請按「連接／重新授權」。',REFRESH_NOT_YET_ALLOWED:'尚未到可更新憑證的時間，請稍後再試；不會改用付費 API。',CREDENTIAL_STORE_BUSY:'另一個登入或更新正在使用憑證，請稍後再試。',PLAN_PERMISSION_NOT_GRANTED:'此連線尚未取得方案用量權限。',PLAN_USAGE_LIMIT_REACHED:'已達訂閱或此應用用量上限，已停止；沒有改用額外付費。',USAGE_LIMIT_OR_RATE_LIMIT:'供應商用量或請求頻率已達限制，已停止，沒有自動重試。',PLAN_USAGE_UNAVAILABLE:'目前無法使用訂閱用量，請稍後再試。',APP_DAILY_REQUEST_LIMIT:'已達本機每日請求保護上限；行情收集不受影響。',APP_REQUEST_COOLDOWN:'距離上一個請求太近，請等待約十秒。',ANALYSIS_ALREADY_RUNNING:'已有分析正在進行，請等待或取消該分析。',ANALYSIS_ALREADY_RUNNING_OR_INTERRUPTED_LOCK:'有另一個分析程序或未結束的保護鎖，已停止新請求，請回報此狀態。',REQUEST_TIMED_OUT:'這次分析超過時間限制，未完成。已停止，不會自動重試。',REQUEST_CANCELLED:'這次分析已取消。取消不代表供應商已產生的用量會退回。',STREAM_INTERRUPTED:'模型連線中斷；目前文字不是完整答案。',MODEL_RESPONSE_INCOMPLETE:'模型回覆未完整完成，不能當作成功分析。',MODEL_REFUSED:'模型未提供這次回答。',CONTEXT_SIZE_LIMIT:'本次盤況超過安全傳送範圍，未發出模型分析。',CONTEXT_VALUE_INVALID:'部分盤況資料不符合傳送格式，未發出模型分析。',SNAPSHOT_DISPATCH_TIME_INVALID:'盤況快照的時間不合格，未發出模型分析。',REQUEST_NOT_FOUND:'此登入階段找不到上次請求；不會自動重新分析。',PREVIOUS_REQUEST_INTERRUPTED:'服務曾中斷，上一次分析未完成；不會自動重發。',SETUP_ALREADY_OPEN:'連線設定視窗已開啟，請使用該分頁完成授權。',UPSTREAM_TLS_UNTRUSTED:'無法驗證官方連線憑證，已停止，沒有降低安全檢查。',UPSTREAM_CONNECTION_FAILED:'無法連到官方服務，請稍後再試。',CREDITS_SETTING_CONFIRMATION_REQUIRED:'請先確認沒有允許額外點數，再勾選確認。'};
 Object.assign(reasons,{
  ACCOUNT_METADATA_NOT_LOADED:'已發現儲存狀態，但尚未讀取帳號；請按「讀取已儲存帳號」。這不代表授權或連線有效。',
  CREDENTIAL_STORE_MISSING:'尚無已儲存的帳號資料；本次不會建立儲存區。需要新增帳號時可自行選擇連接設定。',
  CREDENTIAL_STORE_BUSY:'儲存區正由另一個作業使用，本次未讀取帳號；請稍後手動再試，不會自動修復或重試。',
  CREDENTIAL_ACL_UNSAFE:'儲存區權限未通過檢查，帳號目前不可用；本次不會修改權限或要求重新登入。',
  CREDENTIAL_STORE_UNREADABLE:'無法安全讀取已儲存資料，帳號目前不可用；本次不會重建、修復或重新授權。',
  CREDENTIAL_STORE_INVALID:'已儲存資料的格式未通過檢查，帳號目前不可用；本次不會覆寫資料或要求重新登入。',
  CREDENTIAL_PATH_REJECTED:'儲存路徑未通過安全檢查，本次未讀取帳號，也未修改路徑或權限。',
  CREDENTIAL_FILE_REJECTED:'儲存檔案未通過安全檢查，本次未讀取帳號，也未修改檔案。',
  CREDENTIAL_SECURITY_INSPECTION_FAILED:'目前無法唯讀確認儲存區安全性，帳號暫不可用；本次沒有修改權限。',
  LOCAL_IDENTITY_UNVERIFIED:'目前無法確認本機使用者身分，帳號暫不可用；不會自動重新授權。',
  WINDOWS_PROTECTED_STORE_REQUIRED:'此環境無法使用原Windows保護儲存區；本次不會建立替代儲存區。',
  PREVIOUS_REQUEST_STATE_UNVERIFIED:'上次分析狀態無法確認，未自動重送；可手動查回結果。',
  CREDENTIAL_ACCOUNT_METADATA_INVALID:'帳號中繼資料格式無法確認，本次未載入帳號，也未改動儲存資料。',
  AUTH_REQUIRED:'請先登入行情面板，再按「讀取已儲存帳號」。',
 });
 let csrf='',busy=false,enabled=false,accountsLoaded=false,stateReadEpoch=0,requestId=null,controller=null,connectionTimer=null;
 const storageKey='twchip.ask-gpt.last-request.v1:'+location.port;
 const text=(id,value)=>{$(id).textContent=value??'';};
 function feedback(message,state='IDLE'){text('ai-status',message);$('ai-status').dataset.phase=state;}
 function controls(){
  $('ai-submit').disabled=busy||!enabled||!csrf||!accountsLoaded||!$('ai-account').value||!$('ai-model').value||!$('ai-credits').checked;
  $('ai-models').disabled=busy||!enabled||!csrf||!accountsLoaded||!$('ai-account').value;
  $('ai-connect').disabled=busy||!enabled||!csrf;$('ai-refresh').disabled=busy;
  for(const id of ['ai-account','ai-model','ai-question','ai-credits'])$(id).disabled=busy||!enabled;
  $('ai-cancel').disabled=!busy||!requestId;$('ai-inline').setAttribute('aria-busy',String(busy));
  window.HomeWorkspace?.aiSummary();
 }
 async function session(){const r=await fetch('/api/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});const d=await r.json();if(d.authenticated!==true||typeof d.csrfToken!=='string'||!d.csrfToken)throw Error('AUTH_REQUIRED');csrf=d.csrfToken;}
 async function api(route,body){
  if(!csrf)await session();
  const r=await fetch('/api/v1/ask-gpt/'+route,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
  const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'REQUEST_FAILED');return d.data;
 }
 const knownReason=code=>typeof code==='string'&&Object.hasOwn(reasons,code)?reasons[code]:null;
 const reasonText=code=>String(code||'').startsWith('CONTENT_')?'回答未通過盤況內容核對，未顯示。':knownReason(code)||'狀態原因無法確認；未自動修復或重新授權。';
 const errorText=e=>String(e?.message||'').startsWith('CONTENT_')?reasonText(e.message):knownReason(e?.message)||(e?.name==='TimeoutError'?'讀取逾時，本次未完成。':'操作未完成，無法確認目前狀態。')+'沒有自動重試或額外付費備援。';
 function options(id,rows,empty){const node=$(id),prior=node.value;node.replaceChildren(new Option(empty,''));for(const r of rows)node.add(new Option(r.label,r.key));if(rows.some(r=>r.key===prior))node.value=prior;else if(rows.length===1)node.value=rows[0].key;}
 function clearAccounts(){accountsLoaded=false;options('ai-account',[],'尚未讀取已儲存帳號');options('ai-model',[],'請明確載入帳號與模型');if($('ai-settings-summary'))text('ai-settings-summary','帳號與模型設定 · 尚未讀取帳號');}
 async function connection({allowBusy=false}={}){
  if(busy&&!allowBusy)return;
  const epoch=++stateReadEpoch;
  try{await session();if(epoch!==stateReadEpoch)return;const d=await api('status');if(epoch!==stateReadEpoch)return;enabled=d?.enabled===true;
   // Automatic status never consumes account rows, even from an unexpected response.
   const metadataPresent=d.storeState==='PRESENT_UNVERIFIED'&&d.reason==='ACCOUNT_METADATA_NOT_LOADED';
   if(!enabled||!accountsLoaded||!metadataPresent)clearAccounts();
   if($('ai-settings')&&(!accountsLoaded||d.reason))$('ai-settings').open=true;
   text('ai-connection',!enabled?reasons.INLINE_ASSISTANT_NOT_ACTIVATED:accountsLoaded
    ?'已讀取帳號中繼資料；尚未驗證供應商連線。'
    :d.reason?reasonText(d.reason):reasons.ACCOUNT_METADATA_NOT_LOADED);
   const commit=/^[0-9a-f]{40}$/.test(d.runtimeCommit||'')?d.runtimeCommit.slice(0,12):'未知';
   text('ai-version',`版本 ${commit} · 訂閱授權 · 無付費 API 備援`);
   if(!enabled)feedback(reasons.INLINE_ASSISTANT_NOT_ACTIVATED,'DISABLED');
   else if(!requestId)feedback(accountsLoaded?'請明確載入模型，再於本頁提問。':'只讀取了儲存狀態；要使用保存的帳號，請按「讀取已儲存帳號」。');
  }catch(e){if(epoch!==stateReadEpoch)return;enabled=false;csrf='';clearAccounts();text('ai-connection',errorText(e));feedback(errorText(e),'FAILED');}finally{controls();}
 }
 async function loadAccounts(){
  if(busy)return;++stateReadEpoch;busy=true;controls();feedback('正在唯讀檢查並讀取已儲存帳號…');
  try{await session();if(!enabled){await connection({allowBusy:true});if(!enabled)return;}
   const epoch=++stateReadEpoch,d=await api('accounts',{});if(epoch!==stateReadEpoch)return;
   if(d?.accountMetadataLoaded!==true||!Array.isArray(d.accounts)||d.reason!=null
    ||!d.accounts.every(a=>a&&typeof a.key==='string'&&a.key&&typeof a.label==='string'))throw Error('CREDENTIAL_ACCOUNT_METADATA_INVALID');
   accountsLoaded=true;options('ai-account',d.accounts.map(a=>({key:a.key,label:a.label})),'請選擇已儲存的帳號');
   options('ai-model',[],'請明確載入此帳號的模型');
   if($('ai-settings-summary'))text('ai-settings-summary','帳號與模型設定 · 請明確載入模型');
   text('ai-connection',d.accounts.length?'已讀取已儲存帳號；尚未驗證訂閱授權或供應商連線，請明確載入模型。':'已讀取儲存區，但沒有帳號中繼資料；本次沒有建立或重新授權。');
   feedback(d.accounts.length?'帳號中繼資料已讀取；模型與分析仍需明確操作。':'儲存區沒有可用帳號中繼資料。');
  }catch(e){clearAccounts();if(e?.message==='AUTH_REQUIRED'){csrf='';enabled=false;}text('ai-connection',errorText(e));feedback(errorText(e),'FAILED');}
  finally{busy=false;controls();}
 }
 function receipt(r){
  if(requestId&&r.requestId!==requestId)return;
  const accepted=r.phase==='COMPLETED'&&r.usable===true&&r.contentVerification?.schema==='ask-gpt-verified-claims-v1'&&r.contentVerification?.status==='PASSED';
  text('ai-answer',accepted?r.text:'尚無通過內容核對的回答。');$('ai-answer').dataset.complete=String(accepted);
  const stamp=r.snapshotTime?new Date(r.snapshotTime).toLocaleString('zh-TW',{hour12:false}):'尚未建立';
  const usage=r.usage?.total_tokens!=null?` · 本次 ${r.usage.total_tokens} tokens（不是剩餘額度）`:'';
  text('ai-meta',`使用模型：${r.actualModel||r.requestedModel||'未選擇'} · 快照：${stamp} · ${r.context?.session||'盤別未知'}${usage}`);
  text('ai-evidence',r.context?JSON.stringify(r.context,null,2):'尚未送出盤況。');
  text('ai-receipt',`請求 ${r.requestId} · 最後更新 ${new Date(r.updatedAt).toLocaleTimeString('zh-TW')} · ${accepted?'已核對欄位、數值與狀態；非通用語意保證':'未驗證文字不顯示'}`);
  const phase=r.phase==='COMPLETED'&&!accepted?'FAILED':r.phase;
  feedback((phases[phase]||phase)+(r.error?'：'+reasonText(r.error.code):phase!==r.phase?'：回答缺少內容核對紀錄。':''),phase);
 }
 async function recover(){
  let id;try{id=sessionStorage.getItem(storageKey);}catch{}
  if(!id)return;requestId=id;
  try{const r=await api('requests/'+id);receipt(r);if(!r.finished)feedback('上次請求尚未有終止結果；請按「查回上次結果」，不要重複發送。','INTERRUPTED');}
  catch(e){feedback(errorText(e),'FAILED');}finally{controls();}
 }
 $('ai-refresh').addEventListener('click',()=>{void loadAccounts();});
 $('ai-recover').addEventListener('click',()=>{if(!busy)void recover();});
 $('ai-account').addEventListener('change',()=>{options('ai-model',[],'請重新載入此帳號模型');if($('ai-settings'))$('ai-settings').open=true;if($('ai-settings-summary'))text('ai-settings-summary','帳號與模型設定 · 請重新載入模型');controls();});
 $('ai-models').addEventListener('click',async()=>{
  if(busy)return;busy=true;controls();feedback('正在讀取此帳號的可選模型…');
  try{const d=await api('models',{account:$('ai-account').value});options('ai-model',d.models.map(m=>({key:m.slug,label:m.display_name})),'請選擇模型');
   const terra=d.models.find(m=>m.slug==='gpt-5.6-terra');if(terra)$('ai-model').value=terra.slug;
   feedback('模型目錄已讀取。依你選擇的模型分析，不會自動升級。');
   const selected=d.models.find(m=>m.slug===$('ai-model').value);
   if($('ai-settings'))$('ai-settings').open=!selected;
   if($('ai-settings-summary'))text('ai-settings-summary',selected?'帳號與模型設定 · '+selected.display_name:'帳號與模型設定 · 請選擇模型');
  }catch(e){feedback(errorText(e),'FAILED');}finally{busy=false;controls();}
 });
 $('ai-connect').addEventListener('click',async()=>{
  if(busy)return;busy=true;controls();
  try{const d=await api('setup',{});const u=new URL(d.url);if(u.origin!=='http://127.0.0.1:18721'||u.pathname!=='/'||!u.hash)throw Error('SETUP_URL_REJECTED');
   const a=$('ai-setup-link');a.href=u.href;a.classList.remove('hidden');a.textContent='開啟本機訂閱授權設定';
   feedback('連線設定已準備；完成授權後回到本頁按「讀取已儲存帳號」。');
   try{window.open(u.href,'_blank','noopener,noreferrer');}catch{}
  }catch(e){feedback(errorText(e),'FAILED');}finally{busy=false;controls();}
 });
 $('ai-credits').addEventListener('change',controls);$('ai-model').addEventListener('change',()=>{
  const selected=$('ai-model').selectedOptions[0];
  if($('ai-settings-summary'))text('ai-settings-summary',$('ai-model').value?'帳號與模型設定 · '+selected.textContent:'帳號與模型設定 · 請選擇模型');
  controls();
 });
 document.querySelectorAll('[data-gpt-question]').forEach(b=>b.addEventListener('click',()=>{if(!busy)$('ai-question').value=b.dataset.gptQuestion;}));
 $('ai-submit').addEventListener('click',async()=>{
  if(busy||$('ai-submit').disabled)return;
  const question=$('ai-question').value.trim();if(!question){feedback('請先輸入問題。','FAILED');return;}
  busy=true;requestId=crypto.randomUUID();controller=new AbortController();try{sessionStorage.setItem(storageKey,requestId);}catch{}
  controls();text('ai-answer','');$('ai-answer').dataset.complete='false';text('ai-evidence','正在封存當下盤況…');text('ai-receipt','');feedback('正在封存目前盤況…','PREPARING_SNAPSHOT');
  const timer=setTimeout(()=>controller.abort(),135000);let finished=false,buffer='',count=0;const decoder=new TextDecoder();
  function line(s){if(!s.trim())return;const e=JSON.parse(s);if(e.type==='receipt'){receipt(e.data);finished=e.data.finished;}else if(e.type==='error')throw Error(e.error);}
  try{
   const response=await fetch('/api/v1/ask-gpt/ask',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({requestId,account:$('ai-account').value,model:$('ai-model').value,question,creditsDisabledConfirmed:$('ai-credits').checked}),signal:controller.signal});
   if(!response.ok){const d=await response.json();throw Error(d.error||'REQUEST_FAILED');}
   const reader=response.body.getReader();while(true){const{done,value}=await reader.read();if(done)break;count+=value.length;if(count>2097152)throw Error('RESPONSE_TOO_LARGE');buffer+=decoder.decode(value,{stream:true});let n;while((n=buffer.indexOf('\n'))>=0){line(buffer.slice(0,n));buffer=buffer.slice(n+1);}}
   buffer+=decoder.decode();if(buffer.trim())line(buffer);if(!finished)throw Error('STREAM_INTERRUPTED');
  }catch(e){feedback(errorText(e),'INTERRUPTED');try{const r=await api('requests/'+requestId);receipt(r);}catch{}}
  finally{clearTimeout(timer);busy=false;controller=null;controls();}
 });
 $('ai-cancel').addEventListener('click',async()=>{
  if(!busy||!requestId)return;$('ai-cancel').disabled=true;feedback('已要求取消，正在等待終止紀錄…','CANCELLED');
  try{await api('cancel',{requestId});}catch(e){controller?.abort();feedback(errorText(e),'FAILED');}
 });
 controls();
 // Retry only local session detection briefly; this never submits a model request.
 let checks=0;async function init(){checks++;try{await session();await connection();await recover();}catch{if(checks<30)connectionTimer=setTimeout(init,2000);else feedback('登入面板後，按「讀取已儲存帳號」即可。');}}
 void init();window.addEventListener('pagehide',()=>{clearTimeout(connectionTimer);controller?.abort();});
})();
