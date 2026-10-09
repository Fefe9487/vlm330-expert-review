export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHTML;
export function normalizeType(type){return ({墜落:'墜落、滾落',滾落:'墜落、滾落',被捲:'被夾、被捲'})[type]||type;}
export function sceneMatches(scene,type){return (scene['危害類型']||[]).some(t=>normalizeType(t)===normalizeType(type));}
export function sceneHTML(scene,index){
 const fields=['危害類型','危害媒介','作業型態','空間特徵','防護設施缺失','不安全狀態','不安全行為','信賴度','個資項目'];
 const value=v=>Array.isArray(v)?v.join('、'):v&&typeof v==='object'?JSON.stringify(v):String(v??'');
 return `<section class="scene" data-scene-index="${index}"><h4>AI 情境 ${index+1} · 辨識理由</h4><p class="scene-rationale">${e(scene['危害情境推演']||'原始結果未提供辨識理由。')}</p><dl class="scene-features">${fields.filter(k=>value(scene[k])).map(k=>`<div><dt>${e(k)}</dt><dd>${e(value(scene[k]))}</dd></div>`).join('')}</dl></section>`;
}
export function hazardHTML(photo,h,index){
 const scenes=photo.vlm.map((s,i)=>({s,i})).filter(({s})=>sceneMatches(s,h.type));
 return `<article class="hazard-card" id="hazard-${h.id}"><header class="hazard-heading"><h3><span class="hazard-num">${index+1}</span>${e(h.type)}</h3><span class="chip ${h.immediate_danger?'warning':''}">AI：${h.immediate_danger?'有':'無'}立即危險之虞</span></header><div class="hazard-body">${scenes.length?scenes.map(({s,i})=>sceneHTML(s,i)).join(''):'<p class="source-note">最終報告增列此類型，原始辨識結果沒有對應的情境理由。</p>'}
 <section class="report-section"><h4>引用法規</h4><p class="original-law">${e(h.law_text||'AI 未引用法規。')}</p>${h.laws.map(l=>`<div class="law-entry"><div class="reference-heading"><strong>${e(l.label)}</strong><a href="${e(l.official_url)}" target="_blank" rel="noopener noreferrer">官方法規${l.official_link_is_specific?'':'查詢'} ↗</a></div>${l.ai_texts.length?l.ai_texts.map((text,i)=>`<p class="law-text"><span class="ai-label">AI 提供的條文${l.ai_texts.length>1?`（版本 ${i+1}）`:''}</span>${e(text)}</p>`).join(''):'<p class="muted">AI 未提供此引用的完整條文。</p>'}</div>`).join('')}</section>
 <section class="report-section"><h4>過去職災案例</h4>${h.cases.length?h.cases.map((c,i)=>`<div class="case-entry"><span class="case-index">案例 ${i+1}</span><p>${e(c.text)}</p></div>`).join(''):'<p class="muted">AI 未列出職災案例。</p>'}</section>
 <section class="report-section"><h4>改善建議</h4>${Array.isArray(h.improvements)?`<ul class="report-list">${h.improvements.map(s=>`<li>${e(s)}</li>`).join('')}</ul>`:`<p>${e(h.improvements)}</p>`}<h4 class="ppe-heading">個人防護具</h4><p>${e(h.ppe||'AI 未列出個人防護具。')}</p></section></div></article>`;
}
export function reportHTML(photo){
 const unmatched=photo.vlm.map((s,i)=>({s,i})).filter(({s})=>!photo.hazards.some(h=>sceneMatches(s,h.type)));
 return `<section class="report-intro content-card"><h2>AI 整體描述</h2><p>${e(photo.description)}</p><p class="source-note">以下為待審閱的 AI 內容。條文可能有錯誤；職災案例尚未提供原始來源，請依情境與致災機制評估適切性。</p></section>${photo.hazards.map((h,i)=>hazardHTML(photo,h,i)).join('')}${unmatched.length?`<section class="content-card"><h2>原始辨識的其他情境</h2><p class="muted">這些情境沒有對應到最終報告的危害類型，仍保留原始理由供審閱。</p>${unmatched.map(({s,i})=>sceneHTML(s,i)).join('')}</section>`:''}<section class="content-card"><h2>AI 整體改善建議</h2><ul class="report-list">${photo.overall_improvements.map(s=>`<li>${e(s)}</li>`).join('')}</ul></section>`;
}
