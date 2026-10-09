import {escapeHTML as e} from './content.js';
export const PROBLEM_FIELDS=['hazard_accuracy','law_appropriateness','case_appropriateness'];
export const needsProblemSelection=value=>value==='partial'||value==='inappropriate';
export const emptyProblemItems=()=>Object.fromEntries(PROBLEM_FIELDS.map(field=>[field,[]]));
export function problemOptions(photo,field){
 const hazards=photo.hazards||[];
 if(field==='hazard_accuracy')return [{id:'description',label:'AI 整體描述',target:'ai-description'},...hazards.map((h,i)=>({id:h.id,label:`危害 ${i+1}：${h.type}`,target:`hazard-${h.id}`}))];
 if(field==='law_appropriateness')return [...hazards.flatMap((h,i)=>h.laws.length?h.laws.map(l=>({id:`${h.id}:${l.id}`,label:`危害 ${i+1}（${h.type}）· ${l.label}`,target:`law-${h.id}-${l.id}`})):[{id:`${h.id}:raw`,label:`危害 ${i+1}（${h.type}）· ${h.law_text||'未引用法規'}`,target:`law-${h.id}`}]),{id:'missing',label:'缺少應引用的法規',target:null}];
 if(field==='case_appropriateness')return hazards.flatMap((h,i)=>h.cases.map((c,j)=>({id:`${h.id}:${c.id}`,label:`危害 ${i+1}（${h.type}）· 案例 ${j+1}：${c.text}`,target:`case-${h.id}-${c.id}`})));
 return [];
}
export function selectedProblems(review,field){return Array.isArray(review.problem_items?.[field])?review.problem_items[field]:[];}
export function setOverallVerdict(review,field,value){
 review[field]=value;
 if(PROBLEM_FIELDS.includes(field)){review.problem_items??=emptyProblemItems();if(!needsProblemSelection(value))review.problem_items[field]=[];}
}
export function toggleProblem(review,field,id,checked,photo){
 if(!PROBLEM_FIELDS.includes(field)||!needsProblemSelection(review[field])||!problemOptions(photo,field).some(option=>option.id===id))return false;
 review.problem_items??=emptyProblemItems();const values=selectedProblems(review,field).filter(value=>value!==id);if(checked)values.push(id);review.problem_items[field]=values;return true;
}
export function validateProblemItems(review,photo){
 if(review.problem_items===undefined)return [];
 const fields=review.problem_items,errors=[],add=field=>errors.push({path:field,message:'有問題的項目與這張照片或整體判斷不相符。'});
 if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(key=>!PROBLEM_FIELDS.includes(key))){add('identity');return errors;}
 for(const field of PROBLEM_FIELDS){
  const values=fields[field]??[],allowed=new Set(problemOptions(photo,field).map(option=>option.id));
  if(!Array.isArray(values)||values.some(id=>typeof id!=='string'||!allowed.has(id))||new Set(values).size!==values.length||(values.length&&!needsProblemSelection(review[field])))add(field);
 }
 return errors;
}
export function problemPickerHTML(photo,review,field){
 if(!needsProblemSelection(review[field]))return '';
 const options=problemOptions(photo,field),selected=selectedProblems(review,field),disabled=review.status==='submitted';
 return `<div class="problem-picker"><div class="problem-picker-heading"><strong>哪些項目有問題？</strong><span>已勾 ${selected.length} 項</span></div><p class="muted">可複選，說明仍可留空。</p><div class="problem-options">${options.map(option=>{const preview=option.label.length>100?option.label.slice(0,100)+'…':option.label;return `<div class="problem-option"><label><input type="checkbox" data-problem-field="${field}" value="${e(option.id)}" ${selected.includes(option.id)?'checked':''} ${disabled?'disabled':''}><span>${e(preview)}</span></label>${option.target?`<button type="button" class="text-button" data-problem-target="${e(option.target)}" aria-label="查看 ${e(preview)} 的完整內容">查看</button>`:''}</div>`;}).join('')}</div></div>`;
}
export function problemSummary(review,photo,field){
 if(!needsProblemSelection(review[field]))return '';
 const labels=new Map(problemOptions(photo,field).map(option=>[option.id,option.label]));
 return selectedProblems(review,field).map(id=>`${labels.get(id)||id} [${id}]`).join('\n');
}
