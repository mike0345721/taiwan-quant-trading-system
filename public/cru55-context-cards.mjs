const finite=Number.isFinite;
const fmt=v=>finite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:2}):'不可用';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const paths=['M3 18V10h4v8m3 0V5h4v13m3 0V2h4v16','M12 3a9 9 0 1 0 9 9h-9z M15 3v6h6','M3 7h18M3 17h18M8 3v8m8 2v8','M3 5v14m18-14v14M7 12h10M10 9l2 3-2 3','M3 12h18M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18','M12 3 2 21h20zM12 9v6m0 2v1'];
const names=['現貨 / 指數結構','市場參與度','期貨 / 法人背景','選擇權結構','海外市場背景','風險 / 衝突'];
const routes=['/workspace?space=spot','/workspace?space=spot&section=breadth','/workspace?space=futures','/workspace?space=options','/workspace?space=global',null];
export function contextModels(data){
 const mo=data?.marketOverview,br=data?.marketBreadth,fi=data?.futuresInstitutional,op=data?.options;
 const m=mo?.ok?mo.data:{},b=br?.ok?br.data?.listed:{},otc=br?.ok?br.data?.otc:{},f=fi?.ok?fi.data:{},o=op?.ok?op.data:{};
 const date=x=>x?.dataDate||'日期不可用';
 return [
  {date:date(mo),values:[['加權指數',fmt(m?.twii?.price)],['櫃買指數',fmt(m?.otc?.price)],['主要正貢獻','不可用'],['主要負貢獻','不可用']],summary:'指數快照；貢獻排名需合法權值來源。',type:'contribution'},
  {date:date(br),values:[['上市 漲 / 跌 / 平',[b?.advance,b?.decline,b?.unchanged].map(fmt).join(' / ')],['上櫃 漲 / 跌 / 平',[otc?.advance,otc?.decline,otc?.unchanged].map(fmt).join(' / ')]],summary:'上市與上櫃各自統計；不與本盤合成判讀。',type:'breadth',counts:[b?.advance,b?.decline,b?.unchanged]},
  {date:date(fi),values:[['外資淨未平倉 · 口',fmt(f?.foreignNet)],['單日變化 · 口',f?.deltaAvailable?fmt(f?.foreignNetDelta):'不可用'],['投信淨未平倉 · 口',fmt(f?.trustNet)],['自營淨未平倉 · 口',fmt(f?.dealerNet)]],summary:'盤後法人部位背景，非主動成交方向。',type:'futures',long:f?.foreignLong,short:f?.foreignShort,series:data?.futuresSeries},
  {date:date(op),values:[['契約',o?.contract||'不可用'],['Call / Put OI',`${fmt(o?.totalCallOi)} / ${fmt(o?.totalPutOi)}`],['OI P/C',fmt(o?.oiPcRatio)]],summary:`到期 ${o?.expiryDate||'未知'}；公開 OI 非莊家真實部位。`,type:'options',walls:[o?.putWall?.strike,o?.maxPain,o?.callWall?.strike]},
  {date:'依各市場資料日',values:(data?.globalContext?.latest||[]).map(x=>[`${x.symbol==='NDX'?'NDX 代理':x.symbol} ${x.tradeDate}`,fmt(x.close)]).slice(0,3),summary:'EOD / HISTORICAL；NDX 為代理，不能替代真正 NQ。',type:'global',global:data?.globalContext?.latest||[],series:data?.globalSeries},
  {date:'依各證據來源',values:[['模型權重','0'],['交易能力','未啟用']],summary:'資料受限不是低風險；不建立新綜合分數。',type:'risk'}
 ];
}
function spark(values){if(!Array.isArray(values)||values.length<2||values.some(v=>!finite(v)))return el('small','歷史序列不可用');const min=Math.min(...values),max=Math.max(...values),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 200 28');svg.setAttribute('class','spark');svg.setAttribute('aria-label','歷史觀測序列，非即時');const p=document.createElementNS(svg.namespaceURI,'polyline');p.setAttribute('points',values.map((v,i)=>`${i*200/(values.length-1)},${24-(max===min?10:(v-min)/(max-min)*20)}`).join(' '));svg.append(p);return svg;}
function visual(model,missing){const n=el('div',null,'micro');if(missing){n.append(el('div',missing,'micro-empty'));return n;}
 if(model.type==='contribution')n.append(el('div','貢獻圖不可用｜缺少已接受的權值貢獻來源','micro-empty'));
 if(model.type==='breadth'){if(model.counts.every(v=>finite(v)&&v>=0)&&model.counts.reduce((a,b)=>a+b,0)>0){const bar=el('div',null,'breadth-bar'),sum=model.counts.reduce((a,b)=>a+b,0);model.counts.forEach((v,i)=>{const part=el('i');part.style.width=`${100*v/sum}%`;part.style.background=['var(--price-up)','var(--price-down)','var(--state-neutral)'][i];bar.append(part);});n.append(bar,el('div','上漲 / 下跌 / 平盤 · 依實際家數比例','micro-legend'));}else n.append(el('small','家數不可用'));}
 if(model.type==='futures'){const l=model.long,s=model.short;if(finite(l)&&finite(s)&&l+s>0){const bar=el('div',null,'position-track');for(const v of [Math.max(0,s-l),Math.max(0,l-s)]){const half=el('span'),line=el('i');line.style.width=`${100*v/(l+s)}%`;half.append(line);bar.append(half);}n.append(bar,el('small',`外資空單 ${fmt(s)} ｜ 多單 ${fmt(l)} · 淨額 / 多空合計`));}n.append(el('small',`${model.series?.[0]?.contract||'契約未知'} 市場未平倉歷史`),spark(model.series?.map(x=>x.value)));}
 if(model.type==='options'){if(model.walls.every(finite)){const row=el('div',null,'wall-points');model.walls.forEach((v,i)=>{const cell=el('span',['Put Wall','Max Pain','Call Wall'][i]);cell.append(el('b',fmt(v)));row.append(cell);});n.append(row);}else n.append(el('small','結構點不可用'));}
 if(model.type==='global'){const grid=el('div',null,'global-matrix');for(const sym of ['TWN','NQ','SOX','USDTWD']){const x=model.global.find(x=>x.symbol===sym),box=el('span',sym==='USDTWD'?'USD/TWD':sym);box.append(el('b',finite(x?.returnPct)?`${x.returnPct>0?'▲':x.returnPct<0?'▼':'＝'} ${fmt(Math.abs(x.returnPct))}%`:'不可用'));grid.append(box);}n.append(grid,spark(model.series?.SOX?.map(x=>x.value)),el('small','SOX 歷史收盤路徑；TWN / NQ 缺少合法來源。'));}
 if(model.type==='risk'){const ul=el('ul',null,'risk-list');for(const txt of ['盤中觀測片段，非完整盤別','背景資料日期與圖表獨立','海外 EOD，真正 NQ 不可用'])ul.append(el('li',txt));n.append(ul);}
 return n;}
export function renderContextCards(host,data,{demo=false,available=true}={}){
 const missing=demo?'SYNTHETIC / UI DEMO｜不混入真實背景':!available?'UNAVAILABLE｜此商品 / 月份無隔離資料':!data?'UNAVAILABLE｜背景來源尚未載入':null;
 host.replaceChildren(...contextModels(data).map((model,i)=>{const card=el(routes[i]?'a':'button',null,'context-card');card.setAttribute('aria-label',names[i]);card.id=['spot','breadth','futures','options','global','risk'][i];if(routes[i])card.href=routes[i];else{card.type='button';card.dataset.open='risk';}const h=el('header'),badge=el('span',null,'icon-badge');badge.setAttribute('aria-hidden','true');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[i]);svg.append(p);badge.append(svg);h.append(badge,el('h3',names[i]),el('b','›'));const dl=el('dl');for(const [k,v] of model.values){dl.append(el('dt',k),el('dd',missing?'不可用':v));}const foot=el('div');foot.append(el('small',missing?'UNAVAILABLE':`HISTORICAL · ${model.date}`,'card-truth'),el('p',missing||model.summary));card.append(h,visual(model,missing),dl,foot);return card;}));
}
