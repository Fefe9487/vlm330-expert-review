import {escapeHTML as e} from './content.js';
// Concrete types from the source project's hazard list; independent of AI's labels.
export const MISSED_HAZARD_TYPES=['墜落、滾落','跌倒','衝撞','物體飛落','物體倒塌、崩塌','被撞','被夾、被捲','被切、割、擦傷','踩踏 (踏穿)','溺斃','與高溫、低溫之接觸','與有害物等之接觸','感電','爆炸','物體破裂','火災','不當動作'];
export const MISSED_HAZARD_TAXONOMY='vlm330-concrete17-v1';
export const MAX_MISSED_HAZARDS=100;
export function missedEntries(review){return Array.isArray(review.missed_hazards)?review.missed_hazards:[];}
export function activeMissedEntries(review){return review.completeness==='has_misses'?missedEntries(review).filter(item=>MISSED_HAZARD_TYPES.includes(item.type)):[];}
export function addMissedHazard(review,id=`m-${crypto.randomUUID()}`){
 if(review.status==='submitted'||review.completeness!=='has_misses'||missedEntries(review).length>=MAX_MISSED_HAZARDS)return null;
 review.missed_hazards??=[];review.missed_hazard_taxonomy=MISSED_HAZARD_TAXONOMY;
 if(!/^m-[a-zA-Z0-9_-]{1,64}$/.test(id)||review.missed_hazards.some(item=>item.id===id))return null;
 const item={id,type:'',description:''};review.missed_hazards.push(item);return item;
}
export function updateMissedHazard(review,id,field,value){
 if(review.status==='submitted'||review.completeness!=='has_misses'||!['type','description'].includes(field)||typeof value!=='string')return false;
 if(field==='type'&&value!==''&&!MISSED_HAZARD_TYPES.includes(value))return false;
 if(field==='description'&&value.length>2000)return false;
 const item=missedEntries(review).find(item=>item.id===id);if(!item)return false;item[field]=value;return true;
}
export function removeMissedHazard(review,id){
 if(review.status==='submitted'||review.completeness!=='has_misses')return false;
 const items=missedEntries(review),index=items.findIndex(item=>item.id===id);if(index<0)return false;items.splice(index,1);return true;
}
export function validateMissedHazards(review,requireComplete=false){
 if(review.missed_hazards===undefined)return [];
 const errors=[],add=message=>errors.push({path:'completeness',message}),items=review.missed_hazards;
 if(review.missed_hazard_taxonomy!==MISSED_HAZARD_TAXONOMY){add('漏報的危害分類版本不相符。');return errors;}
 if(!Array.isArray(items)||items.length>MAX_MISSED_HAZARDS){add('漏報項目格式或筆數不正確。');return errors;}
 const seen=new Set();
 for(const [index,item] of items.entries()){
  if(!item||typeof item.id!=='string'||!/^m-[a-zA-Z0-9_-]{1,64}$/.test(item.id)||seen.has(item.id)){add('漏報項目的識別碼不正確或重複。');continue;}
  seen.add(item.id);
  if(item.type!==''&&!MISSED_HAZARD_TYPES.includes(item.type))add(`漏報項目 ${index+1} 的危害類型不在 17 類清單中。`);
  if(typeof item.description!=='string'||item.description.length>2000)add(`漏報項目 ${index+1} 的情境說明格式不正確。`);
  if(requireComplete&&review.completeness==='has_misses'&&item.type==='')add(`請選擇漏報項目 ${index+1} 的危害類型，或移除這筆空白項目。`);
 }
 return errors;
}
export function missedEditorHTML(review){
 const items=missedEntries(review),submitted=review.status==='submitted';
 if(review.completeness!=='has_misses')return items.length?`<p class="missed-draft-note">已保留 ${items.length} 筆補登草稿；選「有漏報」可繼續編輯。</p>`:'';
 return `<section class="missed-editor" aria-label="額外漏報危害"><div class="missed-heading"><strong>補登 AI 未找出的危害</strong><span>${items.length} 筆</span></div><p class="muted">從 17 種危害選擇，可新增多筆；情境說明選填。</p><div class="missed-list">${items.map((item,index)=>`<div class="missed-item" data-missed-row="${e(item.id)}"><div class="missed-item-heading"><strong>漏報項目 ${index+1}</strong>${submitted?'':`<button type="button" class="text-button" data-remove-missed="${e(item.id)}" aria-label="移除漏報項目 ${index+1}">移除</button>`}</div><label for="missed-type-${e(item.id)}">危害類型</label><select id="missed-type-${e(item.id)}" data-missed-id="${e(item.id)}" data-missed-field="type" ${submitted?'disabled':''}><option value="">請選擇危害類型</option>${MISSED_HAZARD_TYPES.map(type=>`<option value="${e(type)}" ${item.type===type?'selected':''}>${e(type)}</option>`).join('')}</select><label for="missed-description-${e(item.id)}">漏報情境或位置 <span class="muted">（選填）</span></label><textarea id="missed-description-${e(item.id)}" data-missed-id="${e(item.id)}" data-missed-field="description" rows="2" maxlength="2000" placeholder="例如：右側電箱有裸露帶電部位。可留空。" ${submitted?'disabled':''}>${e(item.description)}</textarea></div>`).join('')}</div>${submitted?'':`<button type="button" data-action="add-missed" ${items.length>=MAX_MISSED_HAZARDS?'disabled':''}>＋ 新增漏報項目</button>`}</section>`;
}
export function missedCsvValues(review){const items=activeMissedEntries(review);return [items.length,[...new Set(items.map(item=>item.type))].join('、'),items.map((item,index)=>`漏報 ${index+1}：${item.type}${item.description?'；'+item.description:''} [${item.id}]`).join('\n')];}
