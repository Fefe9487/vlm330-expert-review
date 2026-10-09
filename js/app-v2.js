import {APP_VERSION,VERDICTS,VERDICT_LABELS,ACCURACY_LABELS,COMPLETENESS_LABELS,assignedPhotos,validateAssignments,createReview,validateReview,isTouched,makeBundle,validateBundle,csvText,flattenReviews,summarizeRecords,recordKey} from './model-v2.js';
import * as legacyModel from './model.js';
import {ReviewStore} from './storage.js';
import {escapeHTML as e,reportHTML} from './content.js';
import {problemPickerHTML,setOverallVerdict,toggleProblem,validateProblemItems,selectedProblems} from './problem-items.js';

const root=document.querySelector('#app'),params=new URLSearchParams(location.search),qa=params.get('qa')==='1',mode=qa?'qa':'production';
// The previous per-item answers stay in their original database and can be exported.
const store=new ReviewStore(`${mode}-v2`),legacyStore=new ReviewStore(mode);
const state={manifest:null,expert:null,chosen:null,photo:null,review:null,records:new Map(),view:'review',dirty:false,mutation:0,saveError:null,loading:false,legacyCount:0,errors:[]};
const cache=new Map();let saveTimer,savePromise,toastTimer,importPending,zoom=1,requestedPhoto=params.get('photo');
const photos=()=>assignedPhotos(state.manifest,state.expert);
const time=v=>v?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):'尚未保存';
const path=p=>p.split('/').map(encodeURIComponent).join('/');
function toast(message,error=false){const node=document.querySelector('#toast');clearTimeout(toastTimer);node.textContent=message;node.classList.toggle('error',error);node.hidden=false;toastTimer=setTimeout(()=>node.hidden=true,error?7000:3500);}
function counts(){const values=[...state.records.values()];return {submitted:values.filter(r=>r.status==='submitted').length,draft:values.filter(r=>r.status!=='submitted'&&isTouched(r)).length};}
function shell(body){
 root.innerHTML=`<div class="app-shell"><header class="topbar"><div class="brand"><span class="brand-mark" aria-hidden="true">V</span><div><strong>照片危害辨識審閱</strong><span class="brand-sub">VLM330 · 每位專家 30 張</span></div></div><div class="top-actions"><span id="save-label" class="save-state" role="status">本瀏覽器保存</span>${state.expert?`<button data-action="switch-expert">${e(state.expert)} · 切換</button>`:''}<button data-action="help">審閱說明</button></div></header>${qa?'<div class="qa-banner">操作測試模式 · 與正式評分分開保存</div>':''}<nav class="navbar" aria-label="主要功能">${[['review','照片與 AI 內容'],['progress','我的進度與備份'],['manage','評分檔彙整']].map(([v,label])=>`<button class="nav-tab ${state.view===v?'active':''}" data-view="${v}">${label}</button>`).join('')}<span class="local-note">進度保存在此瀏覽器，請定期匯出備份</span></nav><div id="page-error" hidden></div>${body}</div>`;
 updateSaveStatus();
}
function welcome(){
 state.expert=null;
 shell(`<main class="content-page" id="main"><section class="welcome content-card"><h1>選擇你的專家代碼</h1><p>11 位專家各審閱 30 張照片。請對照照片與 AI 內容，完成四項整體判斷；補充意見可留空。</p><div class="welcome-facts"><span><strong>30</strong> 張／人</span><span><strong>330</strong> 張共計</span><span><strong>4</strong> 項判斷／張</span></div><div class="expert-grid">${state.manifest.expert_ids.map(id=>`<button data-expert="${id}" class="${state.chosen===id?'selected':''}" aria-pressed="${state.chosen===id}">${id}</button>`).join('')}</div><button class="primary" data-action="start" ${state.chosen?'':'disabled'}>開始／繼續審閱</button><p class="muted">請使用分配給你的代碼。換裝置時可匯入自己的 JSON 備份。</p><button class="text-button" data-action="restore">匯入評分備份</button></section></main>`);
}
function radioGroup(key,title,labels){return `<fieldset class="score-group" id="score-${key}"><legend>${title}</legend><div class="radio-row">${Object.entries(labels).map(([value,label])=>`<label class="rating-option"><input type="radio" name="${key}" data-field="${key}" value="${value}" ${state.review[key]===value?'checked':''}>${e(label)}</label>`).join('')}</div><div id="problems-${key}">${problemPickerHTML(state.photo,state.review,key)}</div></fieldset>`;}
function scoreHTML(){return `<section class="score-card" id="score-card" aria-labelledby="score-title"><div class="score-heading"><h2 id="score-title">本張照片的整體判斷</h2><span id="score-save-state" class="muted" role="status"></span><span class="chip ${state.review.status==='submitted'?'green':''}">${state.review.status==='submitted'?'已提交':'草稿'}</span></div><p class="score-hint">看完右側內容後選擇即可。</p><div id="validation-errors" role="alert" hidden></div>
 ${radioGroup('hazard_accuracy','1. AI 辨識的危害是否正確？',ACCURACY_LABELS)}
 ${radioGroup('completeness','2. 是否已找出所有危害？',COMPLETENESS_LABELS)}
 ${radioGroup('law_appropriateness','3. 引用法規是否正確且適用？',Object.fromEntries(VERDICTS.map(v=>[v,VERDICT_LABELS[v]])))}
 ${state.review.case_appropriateness==='not_provided'?'<p class="no-cases">4. AI 未提供職災案例，本項免評。</p>':radioGroup('case_appropriateness','4. 職災案例是否適當？',Object.fromEntries(VERDICTS.map(v=>[v,VERDICT_LABELS[v]])))}
 <label class="note-label" for="review-note">補充意見 <span class="muted">（選填）</span></label><textarea id="review-note" data-field="note" rows="2" maxlength="5000" placeholder="例如：漏報感電；部分法規不適用。可留空。">${e(state.review.note)}</textarea></section>`;}
function renderReview(){
 if(!state.photo||!state.review)return welcome();
 const p=state.photo,list=photos(),c=counts(),index=list.findIndex(x=>x.id===p.id),submitted=state.review.status==='submitted';
 shell(`<main class="review-page" id="main"><section class="task-toolbar" aria-label="照片切換"><label for="photo-select">我的照片</label><select id="photo-select">${list.map((p,i)=>`<option value="${e(p.id)}" ${p.id===state.photo.id?'selected':''}>${String(i+1).padStart(2,'0')}. ${e(p.filename)} · ${state.records.get(p.id)?.status==='submitted'?'已提交':state.records.has(p.id)&&isTouched(state.records.get(p.id))?'草稿':'待評'}</option>`).join('')}</select><span id="task-count">已提交 ${c.submitted} / 30</span><div class="progress-track" aria-hidden="true"><span style="width:${c.submitted/30*100}%"></span></div><button data-action="export-json">匯出評分檔</button></section>
 <div class="workspace"><section class="viewer-pane" aria-label="照片與整體判斷"><div class="photo-heading"><h1>${e(p.filename)}</h1><span class="chip">${e(p.domain)} · 第 ${index+1} / 30 張</span></div><button class="photo-stage" id="photo-stage" data-action="zoom" aria-label="放大 ${e(p.filename)}"><img id="main-photo" src="${path(p.image)}" alt="${e(p.filename)} 現場照片"></button><div id="image-failure" class="image-failure" hidden><span>照片未能載入。</span><button data-action="retry-image">重新載入照片</button></div><div class="viewer-tools"><span class="muted">點照片可放大、拖曳檢視</span><button class="text-button" data-action="zoom">放大照片</button></div>${scoreHTML()}</section>
 <section class="report-pane" id="report-pane" aria-label="AI 辨識內容"><div class="report-heading"><h2>AI 辨識結果</h2><span>${p.hazards.length} 項危害 · ${p.vlm.length} 個原始情境</span></div><nav class="hazard-nav" aria-label="跳至危害內容">${p.hazards.map(h=>`<a href="#hazard-${h.id}">${e(h.type)}</a>`).join('')}</nav>${reportHTML(p)}</section></div>
 <footer class="review-footer"><div><button data-action="previous" ${index===0?'disabled':''}>上一張</button><button data-action="next" ${index===list.length-1?'disabled':''}>下一張</button></div><span id="footer-status">${submitted?'已提交，可重新開啟修正':'選擇四項整體判斷後提交'}</span>${submitted?'<button data-action="reopen">重新開啟評分</button>':`<button class="primary" data-action="submit">${c.submitted===29?'提交並完成':'提交並繼續'}</button>`}</footer></main>`);
 for(const input of document.querySelectorAll('#score-card input,#score-card textarea'))input.disabled=submitted;
 const img=document.querySelector('#main-photo');img.addEventListener('error',()=>document.querySelector('#image-failure').hidden=false);img.addEventListener('load',()=>document.querySelector('#image-failure').hidden=true);
 if(img.complete&&!img.naturalWidth)document.querySelector('#image-failure').hidden=false;
 showValidation();
}
function showValidation(){const box=document.querySelector('#validation-errors');if(!box)return;box.hidden=!state.errors.length;box.innerHTML=state.errors.map(err=>`<button class="text-button" data-error="${e(err.path)}">${e(err.message)}</button>`).join('');for(const field of ['hazard_accuracy','completeness','law_appropriateness','case_appropriateness'])document.querySelector('#score-'+field)?.classList.toggle('has-error',state.errors.some(err=>err.path===field));}
function markChanged(){if(!state.review||state.review.status==='submitted')return;state.dirty=true;state.mutation++;state.saveError=null;clearTimeout(saveTimer);saveTimer=setTimeout(()=>void saveCurrent().catch(()=>{}),400);updateSaveStatus();}
function updateSaveStatus(){
 const label=document.querySelector('#save-label');if(label){label.textContent=state.saveError?'保存失敗 · 請匯出備份':state.dirty?'正在保存…':state.review?.updated_at?'已保存 '+time(state.review.updated_at):'本瀏覽器保存';label.classList.toggle('error',!!state.saveError);}
 const scoreSave=document.querySelector('#score-save-state');if(scoreSave)scoreSave.textContent=state.saveError?'保存失敗':state.dirty?'正在保存…':state.review?.updated_at?'已保存':'';
 const error=document.querySelector('#page-error');if(error){error.hidden=!state.saveError;if(state.saveError)error.innerHTML=`<span>${e(state.saveError.message)}</span><button data-action="export-json">匯出備份</button><button data-action="retry-save">重試保存</button>`;}
 const count=document.querySelector('#task-count'),c=counts();if(count)count.textContent=`已提交 ${c.submitted} / 30`;const bar=document.querySelector('.progress-track span');if(bar)bar.style.width=c.submitted/30*100+'%';
 const select=document.querySelector('#photo-select');if(select)for(const option of select.options){const p=photos().find(p=>p.id===option.value),r=state.records.get(p.id),i=photos().indexOf(p);option.textContent=`${String(i+1).padStart(2,'0')}. ${p.filename} · ${r?.status==='submitted'?'已提交':r&&isTouched(r)?'草稿':'待評'}`;}
}
async function rememberCursor(id){try{await store.meta(`cursor:${state.manifest.assignment_version}:${state.expert}`,id);}catch{toast('評分已保存，但無法記住停留位置。下次可從照片清單選回。',true);}}
async function saveCurrent(){
 clearTimeout(saveTimer);
 if(savePromise){await savePromise;if(state.dirty)return saveCurrent();return state.review;}
 if(!state.dirty||!state.review)return state.review;
 savePromise=(async()=>{while(state.dirty){const version=state.mutation,snapshot=structuredClone(state.review),expected=snapshot.revision||0;
  try{const saved=await store.save(snapshot,expected);state.review.revision=saved.revision;state.review.updated_at=saved.updated_at;state.records.set(saved.photo_id,saved);state.dirty=state.mutation!==version;state.saveError=null;updateSaveStatus();}
  catch(error){state.saveError=error;updateSaveStatus();throw error;}
 }await rememberCursor(state.review.photo_id);return state.review;})();
 try{return await savePromise;}finally{savePromise=null;}
}
async function fetchPhoto(id){
 if(cache.has(id))return cache.get(id);const item=state.manifest.photos.find(p=>p.id===id);if(!item)throw new Error('找不到這張照片。');
 const response=await fetch(path(item.data_file),{cache:'no-cache'});if(!response.ok)throw new Error('照片報告載入失敗，請重試。');const p=await response.json();
 if(p.id!==item.id||p.dataset_id!==state.manifest.id||p.image_sha256!==item.image_sha256)throw new Error('照片報告版本不同，請重新載入。');cache.set(id,p);return p;
}
async function openPhoto(id){
 if(state.loading)return;
 if(!state.manifest.assignments[state.expert]?.includes(id))return toast('這張照片不在你分配的 30 張內。',true);
 state.loading=true;
 for(const input of document.querySelectorAll('#score-card input,#score-card textarea'))input.disabled=true;
 try{await saveCurrent();const photo=await fetchPhoto(id),record=await store.get(state.manifest.id,state.expert,id);state.photo=photo;state.review=record||createReview(photo,state.expert,state.manifest);state.dirty=false;state.errors=[];state.saveError=null;state.view='review';
  const search=new URLSearchParams(location.search);search.set('photo',id);search.set('expert',state.expert);history.replaceState(null,'','?'+search.toString());renderReview();await rememberCursor(id);
 }catch(error){
  if(state.photo)renderReview();
  else shell('<main id="main" class="content-page"><section class="empty-panel"><h1>照片報告未能載入</h1><p>'+e(error.message)+'</p><button class="primary" data-action="continue">重新載入照片</button></section></main>');
  toast(error.message,true);
 }finally{state.loading=false;}
}
async function startExpert(id){
 if(!state.manifest.expert_ids.includes(id))return;
 await saveCurrent();state.expert=id;state.chosen=id;state.review=null;state.photo=null;state.dirty=false;
 const ids=state.manifest.assignments[id];state.records=new Map((await store.all(state.manifest.id,id)).filter(r=>r.assignment_version===state.manifest.assignment_version&&ids.includes(r.photo_id)).map(r=>[r.photo_id,r]));
 try{await store.meta('last-expert',id);}catch{toast('無法記住專家代碼，下次請重新選擇。',true);}
 const requested=requestedPhoto;requestedPhoto=null;let cursor;try{cursor=await store.meta(`cursor:${state.manifest.assignment_version}:${id}`);}catch{}
 const first=ids.find(id=>state.records.get(id)?.status!=='submitted')||ids[0];await openPhoto(ids.includes(requested)?requested:ids.includes(cursor)?cursor:first);
}
function nextPhoto(direction,pending=false){const list=photos(),index=list.findIndex(p=>p.id===state.photo?.id);if(!pending)return list[index+direction]?.id;for(let step=1;step<=list.length;step++){const p=list[(index+step)%list.length];if(state.records.get(p.id)?.status!=='submitted')return p.id;}return null;}
async function submit(){
 if(state.loading||state.review.status==='submitted')return;state.errors=validateReview(state.review,state.photo,state.manifest);showValidation();
 if(state.errors.length){document.querySelector('#validation-errors').scrollIntoView({block:'nearest'});document.querySelector('#score-'+state.errors[0].path+' input')?.focus();return toast('請完成尚未選擇的整體判斷。',true);}
 state.review.status='submitted';state.review.submitted_at=new Date().toISOString();state.dirty=true;state.mutation++;
 try{await saveCurrent();}catch{state.review.status='draft';state.review.submitted_at=null;state.dirty=true;state.mutation++;return toast('尚未完成提交，請先匯出備份。',true);}
 toast(`${state.photo.filename} 已提交。`);const next=nextPhoto(1,true);if(next)await openPhoto(next);else{renderReview();openDetail('30 張照片已完成',`<p>你的 30 張照片都已提交。請匯出 JSON 評分檔，回傳給研究團隊。</p><button class="primary" data-dialog-action="export-json">匯出 JSON 評分檔</button>`);}
}
async function changeView(view){await saveCurrent();if(view==='review'){if(!state.expert)return welcome();state.view=view;if(!state.photo)await startExpert(state.expert);else renderReview();}else if(view==='progress')await renderProgress();else await renderManage();}
function metric(value,label,note=''){return `<div><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong><span class="metric-note">${note}</span></div>`;}
async function renderProgress(){
 if(!state.expert)return welcome();state.view='progress';const c=counts(),legacy=await legacyStore.all(state.manifest.id,state.expert),backup=await store.meta(`backup:${state.manifest.id}:${state.expert}`),list=photos().filter(p=>isTouched(state.records.get(p.id)||{}));state.legacyCount=legacy.length;
 shell(`<main class="content-page" id="main"><div class="page-head"><div><h1>${e(state.expert)} 的進度與備份</h1><p>JSON 可回傳與還原進度；CSV 可供統計。</p></div><div class="page-buttons"><button data-action="restore">匯入 JSON 備份</button><button data-action="export-csv">匯出 CSV</button><button class="primary" data-action="export-json">匯出 JSON 評分檔</button></div></div><div class="page-content"><div class="progress-overview">${metric(`${c.submitted} / 30`,'已提交')}${metric(c.draft,'草稿')}${metric(30-c.submitted-c.draft,'尚未開始')}</div><p class="backup-note">${backup?'上次匯出：'+e(time(backup))+'。':'尚未匯出備份。'} 換裝置或回傳評分前，請匯出 JSON。</p>${legacy.length?`<p class="backup-note">保留了 ${legacy.length} 筆舊版逐項評分。新版四項判斷需重新確認，舊資料不列入本次 30 張的完成度。<button data-action="legacy-export">匯出舊版資料</button></p>`:''}${list.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>照片</th><th>產業</th><th>狀態</th><th>危害完整性</th><th>最後保存</th><th></th></tr></thead><tbody>${list.map(p=>{const r=state.records.get(p.id);return `<tr><td>${e(p.filename)}</td><td>${e(p.domain)}</td><td>${r.status==='submitted'?'已提交':'草稿'}</td><td>${e(COMPLETENESS_LABELS[r.completeness]||'尚未判斷')}</td><td>${e(time(r.updated_at))}</td><td><button class="text-button" data-photo="${e(p.id)}">查看／繼續</button></td></tr>`;}).join('')}</tbody></table></div>`:'<div class="empty-panel"><h2>還沒有評分紀錄</h2><button class="primary" data-action="continue">開始審閱</button></div>'}</div></main>`);
}
async function currentRecords(){return (await store.all(state.manifest.id)).filter(r=>r.schema_version===2&&r.assignment_version===state.manifest.assignment_version&&state.manifest.assignments[r.expert_id]?.includes(r.photo_id));}
async function renderManage(){
 state.view='manage';const records=await currentRecords(),stats=summarizeRecords(state.manifest,records),completed=stats.reduce((n,s)=>n+s.submitted,0);
 shell(`<main class="content-page" id="main"><div class="page-head"><div><h1>11 位專家的評分檔彙整</h1><p>匯入專家回傳的 JSON，檢查完成度並匯出統計。</p></div><div class="page-buttons"><button data-action="collection-csv" ${records.length?'':'disabled'}>匯出全部 CSV</button><button data-action="collection-json" ${records.length?'':'disabled'}>匯出彙整 JSON</button><button class="primary" data-action="collect">匯入專家評分檔</button></div></div><div class="page-content"><div class="progress-overview">${metric(`${stats.filter(s=>s.submitted||s.draft).length} / 11`,'已載入專家')}${metric(`${completed} / 330`,'已提交照片','11 位 × 30 張，互不重複')}${metric(stats.reduce((n,s)=>n+s.draft,0),'草稿','草稿不列入判定統計')}</div><p class="backup-note">這裡只顯示本瀏覽器已保存或已匯入的評分。每張照片由一位專家審閱，本次不計算專家間一致性。</p><div class="table-wrap"><table class="data-table"><thead><tr><th>專家</th><th>已提交</th><th>草稿</th><th>有漏報</th><th>辨識正確</th><th>部分正確</th><th>不正確</th><th>資訊不足</th></tr></thead><tbody>${stats.map(s=>`<tr><td>${s.expert_id}</td><td>${s.submitted} / 30</td><td>${s.draft}</td><td>${s.missing_photos}</td><td>${s.verdicts.appropriate}</td><td>${s.verdicts.partial}</td><td>${s.verdicts.inappropriate}</td><td>${s.verdicts.insufficient}</td></tr>`).join('')}</tbody></table></div><p class="muted">以上為照片的整體危害判斷。法規與案例判斷保存在匯出的 CSV／JSON 中。</p></div></main>`);
}
function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function stamp(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
async function exportRecords(){try{await saveCurrent();}catch{toast('備份會包含目前尚未保存的草稿。',true);}let records=(await currentRecords()).filter(r=>r.expert_id===state.expert);if(state.dirty&&state.review)records=[...records.filter(r=>r.photo_id!==state.review.photo_id),structuredClone(state.review)];return records.filter(isTouched);}
async function exportJson(){if(!state.expert)return toast('請先選擇專家代碼。',true);const records=await exportRecords();download(`VLM330_${state.expert}_${stamp()}${qa?'_QA':''}.json`,JSON.stringify(makeBundle(state.manifest,state.expert,records,mode),null,2));try{await store.meta(`backup:${state.manifest.id}:${state.expert}`,new Date().toISOString());}catch{}toast('JSON 評分檔已匯出，請回傳給研究團隊。');if(state.view==='progress')await renderProgress();}
async function exportCsv(all=false){const records=all?await currentRecords():await exportRecords(),photoMap=new Map();await Promise.all([...new Set(records.map(r=>r.photo_id))].map(async id=>photoMap.set(id,await fetchPhoto(id))));download(`VLM330_${all?'11專家彙整':state.expert}_${stamp()}${qa?'_QA':''}.csv`,csvText(flattenReviews(records,photoMap)),'text/csv; charset=utf-8');toast('CSV 已匯出，每張照片一列，包含勾選的問題項目。');}
async function exportCollection(){await saveCurrent();const records=await currentRecords();download(`VLM330_11專家彙整_${stamp()}${qa?'_QA':''}.json`,JSON.stringify({format:'vlm330-review-collection',schema_version:2,app_version:APP_VERSION,dataset_id:state.manifest.id,assignment_version:state.manifest.assignment_version,exported_at:new Date().toISOString(),experts:state.manifest.expert_ids.map(id=>makeBundle(state.manifest,id,records,mode))},null,2));toast('彙整檔已匯出。');}
async function legacyExport(){if(!state.expert)return;const records=await legacyStore.all(state.manifest.id,state.expert);download(`VLM330_${state.expert}_舊版_${stamp()}${qa?'_QA':''}.json`,JSON.stringify(legacyModel.makeBundle(state.manifest,state.expert,records,mode),null,2));toast('舊版資料已匯出，原始紀錄繼續保留。');}
async function checkRecord(r,legacy=false){const p=await fetchPhoto(r.photo_id);if(legacy){const ids=p.hazards.map(h=>h.id);if(Object.keys(r.hazards).length!==ids.length||ids.some(id=>!Object.hasOwn(r.hazards,id)))throw new Error('舊版危害項目不相符。');for(const h of p.hazards){const v=r.hazards[h.id];for(const [kind,items] of [['laws',h.laws],['cases',h.cases]])if(!v[kind]||Object.keys(v[kind]).length!==items.length||items.some(i=>!Object.hasOwn(v[kind],i.id)))throw new Error('舊版引用項目不相符。');if(typeof v.note!=='string'||v.note.length>5000)throw new Error('舊版說明格式不正確。');}}
 if(!legacy&&validateProblemItems(r,p).length)throw new Error(`照片 ${p.filename} 勾選的問題項目不相符。`);
 if(r.status==='submitted'&&(legacy?legacyModel.validateReview(r,p):validateReview(r,p,state.manifest)).length)throw new Error(`照片 ${p.filename} 標示已提交，但評分不完整。`);
}
async function prepareImport(files,collection=false){
 if(!files.length)return;try{await saveCurrent();const bundles=[];
  for(const file of files){if(file.size>30*1024*1024)throw new Error('單一備份檔過大。');const value=JSON.parse(await file.text());if(value.format==='vlm330-review-collection'){if(!Array.isArray(value.experts)||value.experts.length>11)throw new Error('彙整檔格式不正確。');bundles.push(...value.experts);}else bundles.push(value);}
  if(new Set(bundles.map(b=>b.schema_version)).size!==1)throw new Error('請分開匯入舊版與新版評分。');const legacy=bundles[0]?.schema_version===1;
  for(const bundle of bundles)(legacy?legacyModel.validateBundle:validateBundle)(bundle,state.manifest,mode);
  if(!collection&&new Set(bundles.map(b=>b.expert_id)).size>1)throw new Error('多位專家的檔案請到「評分檔彙整」匯入。');
  const map=new Map();for(const b of bundles)for(const r of b.records){const old=map.get(recordKey(r));if(!old||Date.parse(r.updated_at||r.created_at)>Date.parse(old.updated_at||old.created_at))map.set(recordKey(r),r);}const records=[...map.values()];await Promise.all(records.map(r=>checkRecord(r,legacy)));
  const target=legacy?legacyStore:store,existing=new Map((await target.all(state.manifest.id)).map(r=>[recordKey(r),r]));const newer=records.filter(r=>existing.has(recordKey(r))&&Date.parse(r.updated_at||r.created_at)>Date.parse(existing.get(recordKey(r)).updated_at||existing.get(recordKey(r)).created_at)).length;
  importPending={records,collection,legacy,experts:[...new Set(bundles.map(b=>b.expert_id))]};document.querySelector('#import-title').textContent=legacy?'保存舊版評分資料':'匯入評分備份';document.querySelector('#import-body').innerHTML=`<p>專家 ${e(importPending.experts.join('、'))}，共 ${records.length} 筆${legacy?'舊版逐項':'新版整體'}評分。</p>${legacy?'<p class="source-note">舊資料會原樣保留，供匯出備份。新版四項整體判斷需重新確認，舊版完成度不列入本次分組。</p>':'<p>已核對照片、AI 結果與 30 張分組版本。</p>'}<div class="dialog-actions"><button class="primary" data-import-mode="missing">只補入本機沒有的評分</button>${newer?'<button data-import-mode="newer">另以較新版本更新既有評分</button>':''}</div><p class="muted">既有資料更新前會保留歷史版本。</p>`;document.querySelector('#import-dialog').showModal();
 }catch(error){toast(error instanceof SyntaxError?'請選擇有效的 JSON 評分檔。':error.message,true);}
}
async function confirmImport(replaceNewer){if(!importPending)return;const pending=importPending;importPending=null;document.querySelector('#import-dialog').close();try{const result=await (pending.legacy?legacyStore:store).importRecords(pending.records,replaceNewer);toast(`補入 ${result.inserted} 筆，更新 ${result.replaced} 筆，保留 ${result.skipped} 筆。`);state.review=null;state.photo=null;state.dirty=false;if(pending.legacy){await startExpert(pending.experts[0]);await renderProgress();}else if(pending.collection)await renderManage();else await startExpert(pending.experts[0]);}catch(error){toast(error.message,true);}}
function openDetail(title,body){document.querySelector('#detail-title').textContent=title;document.querySelector('#detail-body').innerHTML=body;document.querySelector('#detail-dialog').showModal();}
function help(){openDetail('審閱說明',`<p>每位專家有固定的 30 張照片，先對照現場照片與 AI 的完整內容，再完成四項整體判斷。</p><ol><li>危害辨識：類型與情境理由是否符合照片，是否把推測當成事實。</li><li>危害完整性：是否仍有 AI 沒找出的危害。</li><li>引用法規：名稱、條號、條文與適用情境是否正確；缺少應引用的法規也可判不適當。</li><li>職災案例：作業情境與致災機制是否能支持這張照片的危害；來源未能確認時可選資訊不足。</li></ol><p>選擇部分適當／不適當（或部分正確／不正確）時，可複選有問題的危害、法規或案例，點「查看」可定位完整內容。負面判斷與漏報不必逐項寫理由。若願意補充，可在唯一的意見欄簡述。改善措施、防護具與立即危險判定也可在此補充意見。</p><p>法規評估基準為 2026-10-08 測試日的有效版本。AI 提供的條文是待評估內容，官方連結供查核。</p><p>進度自動保存在此瀏覽器。完成 30 張後，請匯出 JSON 回傳；換裝置可匯入備份。專家代碼用於區分進度。</p>`);}
function openZoom(){if(!state.photo)return;zoom=1;const img=document.querySelector('#zoom-image');document.querySelector('#photo-dialog-title').textContent=state.photo.filename;img.onload=()=>setZoom(1);img.src=path(state.photo.image);img.alt=state.photo.filename+' 現場照片';document.querySelector('#photo-dialog').showModal();requestAnimationFrame(()=>setZoom(1));}
function setZoom(value){zoom=Math.min(5,Math.max(.5,value));const stage=document.querySelector('#zoom-stage'),img=document.querySelector('#zoom-image');if(!img.naturalWidth)return;const fit=Math.min((stage.clientWidth-28)/img.naturalWidth,(stage.clientHeight-28)/img.naturalHeight);img.style.width=Math.round(img.naturalWidth*fit*zoom)+'px';img.style.height=Math.round(img.naturalHeight*fit*zoom)+'px';document.querySelector('#zoom-value').textContent=Math.round(zoom*100)+'%';if(zoom===1){stage.scrollTop=0;stage.scrollLeft=0;}}

root.addEventListener('input',event=>{const el=event.target;if(el.dataset.field==='note'&&state.review?.status!=='submitted'){state.review.note=el.value;markChanged();}});
root.addEventListener('change',event=>{const el=event.target;if(el.id==='photo-select'){void openPhoto(el.value);return;}if(!state.review||state.review.status==='submitted'||state.loading)return;
 if(el.type==='radio'&&el.dataset.field){setOverallVerdict(state.review,el.dataset.field,el.value);const picker=document.querySelector('#problems-'+el.dataset.field);if(picker)picker.innerHTML=problemPickerHTML(state.photo,state.review,el.dataset.field);state.errors=state.errors.filter(err=>err.path!==el.dataset.field);showValidation();markChanged();}
 else if(el.type==='checkbox'&&el.dataset.problemField&&toggleProblem(state.review,el.dataset.problemField,el.value,el.checked,state.photo)){const count=document.querySelector('#problems-'+el.dataset.problemField+' .problem-picker-heading span');if(count)count.textContent=`已勾 ${selectedProblems(state.review,el.dataset.problemField).length} 項`;markChanged();}
});
root.addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button||button.disabled)return;
 if(state.loading)return toast('正在載入照片，請稍候。');
 try{if(button.dataset.expert){state.chosen=button.dataset.expert;welcome();return;}if(button.dataset.photo)return await openPhoto(button.dataset.photo);if(button.dataset.view)return await changeView(button.dataset.view);if(button.dataset.error){const field=document.querySelector('#score-'+button.dataset.error);field?.scrollIntoView({block:'nearest'});field?.querySelector('input')?.focus();return;}
  if(button.dataset.problemTarget){const target=document.getElementById(button.dataset.problemTarget);target?.scrollIntoView({block:'start'});target?.classList.add('problem-focus');setTimeout(()=>target?.classList.remove('problem-focus'),2400);return;}
  const action=button.dataset.action;
  if(action==='start')await startExpert(state.chosen);
  else if(action==='switch-expert'){await saveCurrent();state.review=null;state.photo=null;welcome();}
  else if(action==='help')help();
  else if(action==='zoom')openZoom();
  else if(action==='retry-image'){document.querySelector('#main-photo').src=path(state.photo.image)+'?retry='+Date.now();}
  else if(action==='previous'||action==='next'){const id=nextPhoto(action==='next'?1:-1);if(id)await openPhoto(id);}
  else if(action==='submit')await submit();
  else if(action==='reopen'){state.review.status='draft';state.review.submitted_at=null;markChanged();renderReview();}
  else if(action==='export-json')await exportJson();
  else if(action==='export-csv')await exportCsv();
  else if(action==='collection-csv')await exportCsv(true);
  else if(action==='collection-json')await exportCollection();
  else if(action==='legacy-export')await legacyExport();
  else if(action==='restore')document.querySelector('#restore-file').click();
  else if(action==='collect')document.querySelector('#collection-files').click();
  else if(action==='continue')await openPhoto(photos().find(p=>state.records.get(p.id)?.status!=='submitted')?.id||photos()[0].id);
  else if(action==='retry-save')await saveCurrent();
 }catch(error){toast(error.message||'操作未完成，請重試。',true);}
});
document.addEventListener('click',event=>{const close=event.target.closest('[data-close-dialog]');if(close)document.getElementById(close.dataset.closeDialog).close();const importMode=event.target.closest('[data-import-mode]');if(importMode)void confirmImport(importMode.dataset.importMode==='newer');if(event.target.closest('[data-dialog-action="export-json"]'))void exportJson().catch(error=>toast(error.message,true));});
document.querySelector('#restore-file').addEventListener('change',event=>{void prepareImport([...event.target.files]);event.target.value='';});
document.querySelector('#collection-files').addEventListener('change',event=>{void prepareImport([...event.target.files],true);event.target.value='';});
document.querySelector('#zoom-in').addEventListener('click',()=>setZoom(zoom+.25));document.querySelector('#zoom-out').addEventListener('click',()=>setZoom(zoom-.25));document.querySelector('#zoom-reset').addEventListener('click',()=>setZoom(1));
let drag;const stage=document.querySelector('#zoom-stage');stage.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,left:stage.scrollLeft,top:stage.scrollTop};stage.setPointerCapture(event.pointerId);stage.classList.add('dragging');});stage.addEventListener('pointermove',event=>{if(drag){stage.scrollLeft=drag.left+drag.x-event.clientX;stage.scrollTop=drag.top+drag.y-event.clientY;}});for(const name of ['pointerup','pointercancel'])stage.addEventListener(name,()=>{drag=null;stage.classList.remove('dragging');});
window.addEventListener('beforeunload',event=>{if(state.dirty){void saveCurrent().catch(()=>{});event.preventDefault();event.returnValue='';}});window.addEventListener('pagehide',()=>{if(state.dirty)void saveCurrent().catch(()=>{});});window.addEventListener('resize',()=>{if(document.querySelector('#photo-dialog').open&&zoom===1)setZoom(1);});
async function init(){try{
 const response=await fetch('data/manifest.json',{cache:'no-cache'});if(!response.ok)throw new Error('無法讀取照片清單。');state.manifest=validateAssignments(await response.json());store.name+='-'+state.manifest.assignment_version;await store.open();await legacyStore.open();const remembered=await store.meta('last-expert'),requested=params.get('expert');state.chosen=state.manifest.expert_ids.includes(requested)?requested:state.manifest.expert_ids.includes(remembered)?remembered:null;
 if(state.chosen)await startExpert(state.chosen);else welcome();
 }catch(error){root.innerHTML=`<main id="main" class="initial-state"><h1>暫時無法開啟審閱資料</h1><p>${e(error.message)}</p><p>請確認瀏覽器允許本機保存資料，再重新載入。</p><button class="primary" id="reload-app">重新載入</button></main>`;document.querySelector('#reload-app').onclick=()=>location.reload();}}
void init();
