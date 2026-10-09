export const APP_VERSION='1.0.0';
export const VERDICTS=['appropriate','partial','inappropriate','insufficient'];
export const VERDICT_LABELS={appropriate:'適當',partial:'部分適當',inappropriate:'不適當',insufficient:'資訊不足'};
export const REASONS={type_wrong:'危害類型不符',no_evidence:'畫面缺少依據',inference_as_fact:'將推測寫成事實',mechanism_wrong:'危害機制不符',duplicate:'重複描述',law_wrong:'法規名稱／條號有誤',law_text_wrong:'法規全文／版本有誤',law_irrelevant:'法規不適用',law_missing:'應補充法規',case_irrelevant:'案例致災機制不同',case_context:'案例作業／設備不同',improvement_wrong:'改善措施不適用',ppe_wrong:'防護具不適用',danger_wrong:'危險程度判斷不符',other:'其他'};
export const QUALITY_LABELS={clear:'可判讀',partial:'部分遮蔽／不清楚',unassessable:'無法判讀'};
export const COMPLETENESS_LABELS={no_misses:'未發現漏報',has_misses:'有漏報',insufficient:'無法判斷'};
export const LAW_GAP_LABELS={acceptable:'可接受未引用',missing:'應補充法規',insufficient:'資訊不足'};
export function emptyHazard(h){return {verdict:'',laws:Object.fromEntries(h.laws.map(l=>[l.id,''])),law_gap:'',cases:Object.fromEntries(h.cases.map(c=>[c.id,''])),ppe:'',improvements:'',immediate:'',reason_codes:[],note:'',corrected_type:''};}
export function createReview(photo,expertId){return {schema_version:1,dataset_id:photo.dataset_id,expert_id:expertId,photo_id:photo.id,image_sha256:photo.image_sha256,status:'draft',revision:0,created_at:new Date().toISOString(),updated_at:null,submitted_at:null,quality:'',quality_note:'',completeness:'',missing_types:[],missing_note:'',hazards:Object.fromEntries(photo.hazards.map(h=>[h.id,emptyHazard(h)]))};}
export function validateReview(review,photo){
 const errors=[];
 const add=(section,message,path)=>errors.push({section,message,path});
 if(!review||review.dataset_id!==photo.dataset_id||review.photo_id!==photo.id||review.image_sha256!==photo.image_sha256){add('photo','評分與照片版本不一致，請重新載入。','identity');return errors;}
 if(!Object.hasOwn(QUALITY_LABELS,review.quality))add('photo','請判斷照片是否足以判讀。','quality');
 if(!Object.hasOwn(COMPLETENESS_LABELS,review.completeness))add('photo','請判斷有沒有遺漏危害。','completeness');
 if(review.completeness==='has_misses'&&!review.missing_types?.length&&!review.missing_note?.trim())add('photo','請勾選遺漏的危害類型，或補充說明。','missing_types');
 for(const h of photo.hazards){
  const r=review.hazards?.[h.id],section=`hazard-${h.id}`;
  if(!r){add(section,`「${h.type}」尚未評分。`,h.id);continue;}
  for(const [key,label] of [['verdict','危害判斷'],['improvements','改善建議'],['ppe','個人防護具'],['immediate','立即危險判斷']]){
   if(!VERDICTS.includes(r[key])||(key==='immediate'&&r[key]==='partial'))add(section,`「${h.type}」：請評估${label}。`,`${h.id}.${key}`);
  }
  for(const law of h.laws)if(!VERDICTS.includes(r.laws?.[law.id]))add(section,`「${h.type}」：尚未評估 ${law.label}。`,`${h.id}.laws.${law.id}`);
  if(!h.laws.length&&!Object.hasOwn(LAW_GAP_LABELS,r.law_gap))add(section,`「${h.type}」：請評估未引用法規是否可接受。`,`${h.id}.law_gap`);
  for(const c of h.cases)if(!VERDICTS.includes(r.cases?.[c.id]))add(section,`「${h.type}」：尚未評估案例 ${c.id.slice(1)}。`,`${h.id}.cases.${c.id}`);
  const negative=[r.verdict,r.improvements,r.ppe,r.immediate,...Object.values(r.laws||{}),...Object.values(r.cases||{})].some(v=>v==='partial'||v==='inappropriate')||r.law_gap==='missing';
  if(negative&&!r.reason_codes?.length&&!r.note?.trim())add(section,`「${h.type}」：請勾選修正理由，或補一句說明。`,`${h.id}.reason_codes`);
  if(r.reason_codes?.includes('other')&&!r.note?.trim())add(section,`「${h.type}」：選擇「其他」時，請補充說明。`,`${h.id}.note`);
 }
 return errors;
}
export function markHazardAppropriate(review,h){
 const r=review.hazards[h.id];r.verdict=r.ppe=r.improvements=r.immediate='appropriate';
 for(const l of h.laws)r.laws[l.id]='appropriate';
 for(const c of h.cases)r.cases[c.id]='appropriate';
 if(!h.laws.length)r.law_gap='acceptable';
 // Preserve reasons and notes already entered; this action must not erase expert comments.
 return r;
}
export function hazardProgress(r,h){
 if(!r)return {answered:0,total:4+h.laws.length+h.cases.length+(h.laws.length?0:1)};
 const values=[r.verdict,r.improvements,r.ppe,r.immediate,...h.laws.map(l=>r.laws?.[l.id]),...h.cases.map(c=>r.cases?.[c.id]),...(h.laws.length?[]:[r.law_gap])];
 return {answered:values.filter(Boolean).length,total:values.length};
}
export function isTouched(r){return Boolean(r.quality||r.completeness||r.quality_note||r.missing_note||r.missing_types?.length||Object.values(r.hazards||{}).some(h=>h.verdict||h.ppe||h.improvements||h.immediate||h.law_gap||Object.values(h.laws||{}).some(Boolean)||Object.values(h.cases||{}).some(Boolean)||h.note||h.corrected_type||h.reason_codes?.length));}
export function recordKey(r){return `${r.dataset_id}|${r.expert_id}|${r.photo_id}`;}
export function makeBundle(manifest,expertId,records){return {format:'vlm330-expert-review',schema_version:1,app_version:APP_VERSION,dataset_id:manifest.id,dataset_fingerprint:manifest.fingerprint,expert_id:expertId,exported_at:new Date().toISOString(),photo_count:manifest.photo_count,records:records.filter(r=>r.expert_id===expertId)};}
export function validateBundle(bundle,manifest){
 if(bundle?.format!=='vlm330-expert-review'||bundle.schema_version!==1)throw new Error('這不是支援的評分備份檔。');
 if(bundle.dataset_id!==manifest.id||bundle.dataset_fingerprint!==manifest.fingerprint)throw new Error('備份的照片／AI 結果版本不同，不能匯入這次測試。');
 if(!manifest.expert_ids.includes(bundle.expert_id))throw new Error('備份中的專家代碼不在 A01–A11 清單中。');
 if(!Array.isArray(bundle.records)||bundle.records.length>manifest.photo_count)throw new Error('備份的評分筆數不正確。');
 const photos=new Map(manifest.photos.map(p=>[p.id,p])),seen=new Set();
 for(const r of bundle.records){
  const p=photos.get(r.photo_id);
  if(!p||r.dataset_id!==manifest.id||r.expert_id!==bundle.expert_id||r.image_sha256!==p.image_sha256||r.schema_version!==1)throw new Error('備份包含不相符的專家、照片或版本。');
  if(seen.has(r.photo_id))throw new Error(`備份含重複照片：${r.photo_id}`);
  seen.add(r.photo_id);
  if(!['draft','submitted'].includes(r.status)||!r.hazards||typeof r.hazards!=='object'||Array.isArray(r.hazards))throw new Error(`照片 ${r.photo_id} 的評分格式不正確。`);
  for(const key of ['created_at','updated_at','submitted_at'])if(r[key]!==null&&r[key]!==undefined&&(!Number.isFinite(Date.parse(r[key]))||typeof r[key]!=='string'))throw new Error('備份的時間格式不正確。');
  for(const key of ['quality_note','missing_note'])if(typeof r[key]!=='string'||r[key].length>5000)throw new Error('備份的補充說明格式不正確。');
  for(const h of Object.values(r.hazards)){
   if(!h||typeof h!=='object'||!Array.isArray(h.reason_codes)||h.reason_codes.some(k=>!Object.hasOwn(REASONS,k)))throw new Error(`照片 ${r.photo_id} 的理由格式不正確。`);
   if([h.verdict,h.ppe,h.improvements,h.immediate,...Object.values(h.laws||{}),...Object.values(h.cases||{})].some(v=>v!==''&&!VERDICTS.includes(v)))throw new Error(`照片 ${r.photo_id} 的評分選項不正確。`);
   if(h.corrected_type!==''&&!manifest.hazard_types.includes(h.corrected_type))throw new Error('建議危害類型不正確。');
   if(h.law_gap!==''&&!Object.hasOwn(LAW_GAP_LABELS,h.law_gap))throw new Error('未引用法規的判斷不正確。');
  }
  if(r.quality!==''&&!Object.hasOwn(QUALITY_LABELS,r.quality))throw new Error('照片判讀選項不正確。');
  if(r.completeness!==''&&!Object.hasOwn(COMPLETENESS_LABELS,r.completeness))throw new Error('漏報選項不正確。');
  if(!Array.isArray(r.missing_types)||r.missing_types.some(t=>!manifest.hazard_types.includes(t)))throw new Error('遺漏危害類型不正確。');
 }
 return bundle;
}
export function csvCell(value){let s=String(value??'');if(/^\s*[=+\-@]|^[\t\r\n]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;}
export function csvText(rows){return '\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');}
export function flattenReviews(records,photos){
 const header=['專家代碼','照片','狀態','照片判讀','完整性','漏報類型','項目分類','危害類型','引用項目','判定','理由','修正／說明','更新時間'];
 const rows=[header];
 for(const r of records){
  const photo=photos.get(r.photo_id);
  if(!photo)continue;
  const base=[r.expert_id,photo.filename,r.status==='submitted'?'已提交':'草稿',QUALITY_LABELS[r.quality]||'',COMPLETENESS_LABELS[r.completeness]||'',(r.missing_types||[]).join('、')];
  rows.push([...base,'照片','','','',(r.quality_note||''),r.missing_note||'',r.updated_at||'']);
  for(const h of photo.hazards){
   const v=r.hazards[h.id];if(!v)continue;
   const reasons=(v.reason_codes||[]).map(k=>REASONS[k]||k).join('、');
   const push=(kind,item,status)=>rows.push([...base,kind,h.type,item,VERDICT_LABELS[status]||LAW_GAP_LABELS[status]||'',reasons,[v.corrected_type&&`建議類型：${v.corrected_type}`,v.note].filter(Boolean).join('；'),r.updated_at||'']);
   push('危害','危害判斷',v.verdict);
   for(const law of h.laws)push('法規',law.label,v.laws?.[law.id]);
   if(!h.laws.length)push('法規',h.law_text||'未引用',v.law_gap);
   for(const c of h.cases)push('案例',c.text,v.cases?.[c.id]);
   push('改善','改善建議',v.improvements);push('防護具',h.ppe,v.ppe);push('危險程度',String(h.immediate_danger),v.immediate);
  }
 }
 return rows;
}
export function summarizeRecords(manifest,records){
 const stats=manifest.expert_ids.map(id=>({expert_id:id,submitted:0,draft:0,missing_photos:0,verdicts:Object.fromEntries(VERDICTS.map(v=>[v,0]))}));
 const byId=new Map(stats.map(s=>[s.expert_id,s]));
 for(const r of records){const s=byId.get(r.expert_id);if(!s)continue;if(r.status==='submitted')s.submitted++;else s.draft++;
  if(r.status==='submitted'){if(r.completeness==='has_misses')s.missing_photos++;for(const h of Object.values(r.hazards||{}))if(Object.hasOwn(s.verdicts,h.verdict))s.verdicts[h.verdict]++;}
 }
 return stats;
}
