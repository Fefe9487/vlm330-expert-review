import {emptyProblemItems,validateProblemItems,problemSummary,PROBLEM_FIELDS} from './problem-items.js';
export const APP_VERSION='2.1.0';
export const VERDICTS=['appropriate','partial','inappropriate','insufficient'];
export const VERDICT_LABELS={appropriate:'適當',partial:'部分適當',inappropriate:'不適當',insufficient:'資訊不足',not_provided:'未提供案例'};
export const COMPLETENESS_LABELS={no_misses:'未發現漏報',has_misses:'有漏報',insufficient:'無法判斷'};
export const ACCURACY_LABELS={appropriate:'正確',partial:'部分正確',inappropriate:'不正確',insufficient:'資訊不足'};
export const SCORE_FIELDS={hazard_accuracy:'危害辨識',completeness:'危害完整性',law_appropriateness:'引用法規',case_appropriateness:'職災案例'};
export function validateAssignments(m){
 if(m.expert_ids?.length!==11||new Set(m.expert_ids).size!==11||m.photos?.length!==330||m.photo_count!==330||!m.assignment_version)throw new Error('照片分組資料不完整。');
 const known=new Set(m.photos.map(p=>p.id)),seen=new Set();
 for(const id of m.expert_ids){const ids=m.assignments?.[id];if(!Array.isArray(ids)||ids.length!==30)throw new Error('每位專家應有 30 張照片。');for(const photo of ids){if(!known.has(photo)||seen.has(photo))throw new Error('照片分組有遺漏或重複。');seen.add(photo);}}
 if(seen.size!==330||known.size!==330)throw new Error('照片分組未涵蓋全部 330 張。');return m;
}
export function assignedPhotos(m,expert){const byId=new Map(m.photos.map(p=>[p.id,p]));return (m.assignments[expert]||[]).map(id=>byId.get(id));}
export function createReview(photo,expert,m){return {schema_version:2,dataset_id:photo.dataset_id,assignment_version:m.assignment_version,expert_id:expert,photo_id:photo.id,image_sha256:photo.image_sha256,status:'draft',revision:0,created_at:new Date().toISOString(),updated_at:null,submitted_at:null,hazard_accuracy:'',completeness:'',law_appropriateness:'',case_appropriateness:photo.hazards.some(h=>h.cases.length)?'':'not_provided',problem_items:emptyProblemItems(),note:''};}
export function validateReview(r,p,m){
 const errors=[],add=(path,message)=>errors.push({path,message});
 if(!r||r.schema_version!==2||r.dataset_id!==p.dataset_id||r.photo_id!==p.id||r.image_sha256!==p.image_sha256){add('identity','評分與照片版本不一致。');return errors;}
 if(m&&(r.assignment_version!==m.assignment_version||!m.assignments[r.expert_id]?.includes(p.id))){add('identity','照片不屬於這位專家的分組。');return errors;}
 if(!VERDICTS.includes(r.hazard_accuracy))add('hazard_accuracy','請判斷危害辨識是否正確。');
 if(!Object.hasOwn(COMPLETENESS_LABELS,r.completeness))add('completeness','請判斷有沒有漏報危害。');
 if(!VERDICTS.includes(r.law_appropriateness))add('law_appropriateness','請整體評估引用法規。');
 if(p.hazards.some(h=>h.cases.length)){if(!VERDICTS.includes(r.case_appropriateness))add('case_appropriateness','請整體評估職災案例。');}
 else if(r.case_appropriateness!=='not_provided')add('case_appropriateness','AI 未提供案例，請重新載入這張照片。');
 errors.push(...validateProblemItems(r,p));
 if(typeof r.note!=='string'||r.note.length>5000)add('note','補充意見請控制在 5,000 字內。');return errors;
}
export function isTouched(r){return Boolean(r.hazard_accuracy||r.completeness||r.law_appropriateness||(r.case_appropriateness&&r.case_appropriateness!=='not_provided')||r.note||PROBLEM_FIELDS.some(field=>r.problem_items?.[field]?.length));}
export function recordKey(r){return `${r.dataset_id}|${r.expert_id}|${r.photo_id}`;}
export function makeBundle(m,expert,records,mode='production'){
 const ids=m.assignments[expert];return {format:'vlm330-expert-review',schema_version:2,app_version:APP_VERSION,mode,dataset_id:m.id,dataset_fingerprint:m.fingerprint,assignment_version:m.assignment_version,assigned_photo_ids:[...ids],expert_id:expert,exported_at:new Date().toISOString(),photo_count:ids.length,dataset_photo_count:m.photo_count,records:records.filter(r=>r.expert_id===expert&&ids.includes(r.photo_id))};
}
export function validateBundle(b,m,mode='production'){
 if(b?.format!=='vlm330-expert-review'||b.schema_version!==2)throw new Error('這不是新版整體評分備份檔。');
 if((b.mode||'production')!==mode)throw new Error('操作測試資料與正式評分不能混用。');
 if(b.dataset_id!==m.id||b.dataset_fingerprint!==m.fingerprint)throw new Error('備份的照片／AI 結果版本不同。');
 if(!m.expert_ids.includes(b.expert_id))throw new Error('備份中的專家代碼不在 A01–A11 清單中。');
 const ids=m.assignments[b.expert_id];
 if(b.assignment_version!==m.assignment_version||JSON.stringify(b.assigned_photo_ids)!==JSON.stringify(ids)||b.photo_count!==30)throw new Error('備份的照片分組版本不同。');
 if(!Array.isArray(b.records)||b.records.length>30)throw new Error('每位專家最多 30 筆照片評分。');
 const photos=new Map(m.photos.map(p=>[p.id,p])),seen=new Set();
 for(const r of b.records){const p=photos.get(r.photo_id);
  if(!p||!ids.includes(r.photo_id)||r.expert_id!==b.expert_id||r.dataset_id!==m.id||r.image_sha256!==p.image_sha256||r.schema_version!==2||r.assignment_version!==m.assignment_version)throw new Error('備份包含不相符的專家、照片或分組版本。');
  if(seen.has(r.photo_id))throw new Error(`備份含重複照片：${r.photo_id}`);seen.add(r.photo_id);
  if(!['draft','submitted'].includes(r.status)||!Number.isInteger(r.revision)||r.revision<0)throw new Error('備份的評分狀態格式不正確。');
  for(const key of ['created_at','updated_at','submitted_at'])if(r[key]!=null&&(typeof r[key]!=='string'||!Number.isFinite(Date.parse(r[key]))))throw new Error('備份的時間格式不正確。');
  if(typeof r.created_at!=='string'||(r.status==='submitted'&&!r.submitted_at))throw new Error('備份缺少建立或提交時間。');
  for(const key of ['hazard_accuracy','law_appropriateness'])if(r[key]!==''&&!VERDICTS.includes(r[key]))throw new Error('備份的評分選項不正確。');
  if(r.case_appropriateness!==''&&r.case_appropriateness!=='not_provided'&&!VERDICTS.includes(r.case_appropriateness))throw new Error('備份的案例選項不正確。');
  if((p.case_count>0&&r.case_appropriateness==='not_provided')||(p.case_count===0&&r.case_appropriateness!=='not_provided'))throw new Error('備份的案例免評狀態與原始報告不符。');
  if(r.completeness!==''&&!Object.hasOwn(COMPLETENESS_LABELS,r.completeness))throw new Error('備份的漏報選項不正確。');
  if(typeof r.note!=='string'||r.note.length>5000)throw new Error('備份的補充說明格式不正確。');
  if(r.problem_items!==undefined){if(!r.problem_items||typeof r.problem_items!=='object'||Array.isArray(r.problem_items)||Object.keys(r.problem_items).some(key=>!PROBLEM_FIELDS.includes(key)))throw new Error('備份的問題項目格式不正確。');for(const field of PROBLEM_FIELDS){const ids=r.problem_items[field]??[];if(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string'||id.length>80)||new Set(ids).size!==ids.length)throw new Error('備份的問題項目格式不正確。');}}
 }return b;
}
export function csvCell(value){let s=String(value??'');if(/^\s*[=+\-@]|^[\t\r\n]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;}
export function csvText(rows){return '\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');}
export function flattenReviews(records,photos){return [['專家代碼','照片','產業','狀態','危害辨識','危害完整性','引用法規','職災案例','補充意見','更新時間','分組版本','有問題的危害','有問題的法規','有問題的案例'],...records.filter(r=>photos.has(r.photo_id)).map(r=>[r.expert_id,photos.get(r.photo_id).filename,photos.get(r.photo_id).domain,r.status==='submitted'?'已提交':'草稿',ACCURACY_LABELS[r.hazard_accuracy]||'',COMPLETENESS_LABELS[r.completeness]||'',VERDICT_LABELS[r.law_appropriateness]||'',VERDICT_LABELS[r.case_appropriateness]||'',r.note,r.updated_at||'',r.assignment_version,...PROBLEM_FIELDS.map(field=>problemSummary(r,photos.get(r.photo_id),field))])];}
export function summarizeRecords(m,records){
 const stats=m.expert_ids.map(id=>({expert_id:id,total:m.assignments[id].length,submitted:0,draft:0,missing_photos:0,verdicts:Object.fromEntries(VERDICTS.map(v=>[v,0]))})),byId=new Map(stats.map(s=>[s.expert_id,s])),seen=new Set();
 for(const r of records){const s=byId.get(r.expert_id),key=recordKey(r);if(!s||r.schema_version!==2||r.assignment_version!==m.assignment_version||!m.assignments[r.expert_id].includes(r.photo_id)||seen.has(key))continue;seen.add(key);
  if(r.status==='submitted'){s.submitted++;if(r.completeness==='has_misses')s.missing_photos++;if(Object.hasOwn(s.verdicts,r.hazard_accuracy))s.verdicts[r.hazard_accuracy]++;}else if(isTouched(r))s.draft++;
 }return stats;
}
