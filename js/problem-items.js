import {escapeHTML as e} from './content.js';
export const PROBLEM_FIELDS=['hazard_accuracy','law_appropriateness','case_appropriateness'];
export const PROBLEM_NOTE_LIMIT=500;
export const needsProblemSelection=value=>value==='partial'||value==='inappropriate';
export const emptyProblemItems=()=>Object.fromEntries(PROBLEM_FIELDS.map(field=>[field,[]]));
export const emptyProblemNotes=()=>Object.fromEntries(PROBLEM_FIELDS.map(field=>[field,{}]));
export function problemOptions(photo,field){
 const hazards=photo.hazards||[];
 if(field==='hazard_accuracy')return [{id:'description',label:'AI 整體描述',target:'ai-description'},...hazards.map((h,i)=>({id:h.id,label:`危害 ${i+1}：${h.type}`,target:`hazard-${h.id}`}))];
 if(field==='law_appropriateness')return [...hazards.flatMap((h,i)=>h.laws.length?h.laws.map(l=>({id:`${h.id}:${l.id}`,label:`危害 ${i+1}（${h.type}）· ${l.label}`,target:`law-${h.id}-${l.id}`})):[{id:`${h.id}:raw`,label:`危害 ${i+1}（${h.type}）· ${h.law_text||'未引用法規'}`,target:`law-${h.id}`}]),{id:'missing',label:'缺少應引用的法規',target:null}];
 if(field==='case_appropriateness')return hazards.flatMap((h,i)=>h.cases.map((c,j)=>({id:`${h.id}:${c.id}`,label:`危害 ${i+1}（${h.type}）· 案例 ${j+1}：${c.text}`,target:`case-${h.id}-${c.id}`})));
 return [];
}
export function selectedProblems(review,field){return Array.isArray(review.problem_items?.[field])?review.problem_items[field]:[];}
export function problemNote(review,field,id){const text=review.problem_notes?.[field]?.[id];return typeof text==='string'?text:'';}
export function setOverallVerdict(review,field,value){
 review[field]=value;
 if(PROBLEM_FIELDS.includes(field)){review.problem_items??=emptyProblemItems();if(!needsProblemSelection(value)){review.problem_items[field]=[];if(review.problem_notes?.[field])review.problem_notes[field]={};}}
}
export function toggleProblem(review,field,id,checked,photo){
 if(!PROBLEM_FIELDS.includes(field)||!needsProblemSelection(review[field])||!problemOptions(photo,field).some(option=>option.id===id))return false;
 review.problem_items??=emptyProblemItems();const values=selectedProblems(review,field).filter(value=>value!==id);if(checked)values.push(id);else if(review.problem_notes?.[field])delete review.problem_notes[field][id];review.problem_items[field]=values;return true;
}
export function setProblemNote(review,field,id,text,photo){
 if(typeof text!=='string'||text.length>PROBLEM_NOTE_LIMIT||!PROBLEM_FIELDS.includes(field)||!needsProblemSelection(review[field])||!selectedProblems(review,field).includes(id)||!problemOptions(photo,field).some(option=>option.id===id))return false;
 review.problem_notes??=emptyProblemNotes();review.problem_notes[field]??={};if(text)review.problem_notes[field][id]=text;else delete review.problem_notes[field][id];return true;
}
export function validateProblemItems(review,photo){
 if(review.problem_items===undefined&&review.problem_notes===undefined)return [];
 const fields=review.problem_items,errors=[],add=field=>errors.push({path:field,message:'有問題的項目與這張照片或整體判斷不相符。'});
 if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(key=>!PROBLEM_FIELDS.includes(key))){add('identity');return errors;}
 const notes=review.problem_notes;
 if(notes!==undefined&&(!notes||typeof notes!=='object'||Array.isArray(notes)||Object.keys(notes).some(key=>!PROBLEM_FIELDS.includes(key)))){add('identity');return errors;}
 for(const field of PROBLEM_FIELDS){
  const values=fields[field]??[],allowed=new Set(problemOptions(photo,field).map(option=>option.id));
  if(!Array.isArray(values)||values.some(id=>typeof id!=='string'||!allowed.has(id))||new Set(values).size!==values.length||(values.length&&!needsProblemSelection(review[field]))){add(field);continue;}
  const itemNotes=notes?.[field]??{};
  if(!itemNotes||typeof itemNotes!=='object'||Array.isArray(itemNotes)||Object.entries(itemNotes).some(([id,text])=>typeof text!=='string'||!text||text.length>PROBLEM_NOTE_LIMIT||!values.includes(id)))add(field);
 }
 return errors;
}
export function problemReasonLabel(field){return field==='hazard_accuracy'?'不正確':'不適當';}
export function validateProblemReasons(review){
 if(!review?.problem_items||typeof review.problem_items!=='object'||Array.isArray(review.problem_items))return [];
 const errors=[];
 for(const field of PROBLEM_FIELDS){
  if(review[field]!=='inappropriate')continue;
  const values=selectedProblems(review,field),word=problemReasonLabel(field);
  if(!values.length||values.some(id=>!problemNote(review,field,id).trim()))errors.push({path:field,message:`選了${word}，請勾出有問題的項目，並在每一項寫原因。`});
 }
 return errors;
}
export function problemPickerHTML(photo,review,field){
 if(!needsProblemSelection(review[field]))return '';
 const options=problemOptions(photo,field),selected=selectedProblems(review,field),disabled=review.status==='submitted',required=review[field]==='inappropriate',word=problemReasonLabel(field);
 return `<div class="problem-picker"><div class="problem-picker-heading"><strong>哪些項目有問題？</strong><span>已勾 ${selected.length} 項</span></div><p class="muted">${required?`可複選。選了${word}，勾選的每一項都要寫原因。`:'可複選。勾選後可寫這項的問題，也可留空。'}</p><div class="problem-options">${options.map(option=>{const preview=option.label.length>100?option.label.slice(0,100)+'…':option.label,checked=selected.includes(option.id);return `<div class="problem-option"><label><input type="checkbox" data-problem-field="${field}" value="${e(option.id)}" ${checked?'checked':''} ${disabled?'disabled':''}><span>${e(preview)}</span></label>${option.target?`<button type="button" class="text-button" data-problem-target="${e(option.target)}" aria-label="查看 ${e(preview)} 的完整內容">查看</button>`:''}${checked?`<label class="problem-note${required?' is-required':''}"><span>${required?'原因（必填）':'這項的問題'}</span><textarea data-problem-note="${field}" data-problem-id="${e(option.id)}" rows="2" maxlength="${PROBLEM_NOTE_LIMIT}" ${required?'required aria-required="true"':''} placeholder="${required?`請寫這項${word}的原因。`:'這項哪裡有問題？可留空。'}">${e(problemNote(review,field,option.id))}</textarea></label>`:''}</div>`;}).join('')}</div></div>`;
}
export const JUDGMENT_FIELDS=['hazard_accuracy','completeness','law_appropriateness','case_appropriateness'];
export const JUDGMENT_NOTE_LIMIT=1000;
export const emptyJudgmentNotes=()=>Object.fromEntries(JUDGMENT_FIELDS.map(field=>[field,'']));
export function judgmentWord(field){return field==='completeness'?'無法判斷':'資訊不足';}
export function judgmentNote(review,field){const text=review.judgment_notes?.[field];return typeof text==='string'?text:'';}
export function setJudgmentNote(review,field,text){
 if(!JUDGMENT_FIELDS.includes(field)||review[field]!=='insufficient'||typeof text!=='string'||text.length>JUDGMENT_NOTE_LIMIT)return false;
 review.judgment_notes??=emptyJudgmentNotes();review.judgment_notes[field]=text;return true;
}
export function validateJudgmentNotes(review){
 if(review.judgment_notes!==undefined&&(!review.judgment_notes||typeof review.judgment_notes!=='object'||Array.isArray(review.judgment_notes)||Object.keys(review.judgment_notes).some(key=>!JUDGMENT_FIELDS.includes(key))))return [{path:'identity',message:'資訊不足的說明格式不正確。'}];
 const errors=[];
 for(const field of JUDGMENT_FIELDS){
  if(review[field]!=='insufficient')continue;
  const text=judgmentNote(review,field);
  if(!text.trim())errors.push({path:field,message:`選了${judgmentWord(field)}，請說明原因。`});
  else if(text.length>JUDGMENT_NOTE_LIMIT)errors.push({path:field,message:`${judgmentWord(field)}的說明請控制在 1,000 字內。`});
 }
 return errors;
}
export function judgmentNoteHTML(review,field){
 if(review[field]!=='insufficient')return '';
 const word=judgmentWord(field);
 return `<label class="judgment-note"><span>請說明為什麼${word}（必填）</span><textarea data-judgment-note="${field}" rows="2" maxlength="${JUDGMENT_NOTE_LIMIT}" required aria-required="true" placeholder="請寫看不出哪一項事實。">${e(judgmentNote(review,field))}</textarea></label>`;
}
export function problemSummary(review,photo,field){
 if(!needsProblemSelection(review[field]))return '';
 const labels=new Map(problemOptions(photo,field).map(option=>[option.id,option.label]));
 return selectedProblems(review,field).map(id=>{const note=problemNote(review,field,id).trim();return `${labels.get(id)||id} [${id}]${note?`：${note}`:''}`;}).join('\n');
}
