"""Build static review data from the revised photos and the frozen AI workbook."""
from __future__ import annotations
from pathlib import Path
from collections import Counter
import argparse
import hashlib
import json
import re
import shutil
import sys
import openpyxl

DEFAULT_PROJECT=Path(__file__).resolve().parents[1]
HAZARD_TYPES=['墜落、滾落','跌倒','衝撞','物體飛落','物體倒塌、崩塌','被撞','被夾、被捲','被切、割、擦傷','踩踏 (踏穿)','溺斃','與高溫、低溫之接觸','與有害物等之接觸','感電','爆炸','物體破裂','火災','不當動作','其他','無法歸類者']
LAW_URLS={
 '職業安全衛生設施規則':'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0060009',
 '營造安全衛生設施標準':'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0060014',
 '職業安全衛生法':'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0060001',
 '缺氧症預防規則':'https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0060020',
}
LAW_RX=re.compile(r'([\u4e00-\u9fff]+?(?:規則|標準|辦法|指引|法))\s*第\s*(\d+(?:\s*[-之－]\s*\d+)?)\s*條(?:\s*第\s*\d+\s*[項款])?')
def digest(path:Path)->str:
 return hashlib.sha256(path.read_bytes()).hexdigest()
def normal_number(value:str)->str:
 return re.sub(r'\s|第|條','',str(value)).replace('之','-').replace('－','-')
def write_json(path:Path,value)->None:
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
def split_refs(text:str,details:list)->tuple[list,list]:
 refs=[];seen=set()
 for match in LAW_RX.finditer(text):
  law,number=match.group(1),normal_number(match.group(2))
  key=(law,number)
  if key in seen:continue
  seen.add(key)
  matches=[d for d in details if d['法規名稱'].strip()==law and normal_number(d['條號'])==number]
  refs.append({'id':f'l{len(refs)+1:02d}','label':match.group(0),'law_name':law,'article':number,
   'ai_texts':list(dict.fromkeys(d['完整法規內文'] for d in matches)),
   'official_url':LAW_URLS.get(law,'https://law.moj.gov.tw/'),
   'official_link_is_specific':law in LAW_URLS})
 # Keep material that the parser cannot interpret visible and rateable.
 remainder=LAW_RX.sub('',text).strip(' 、，,；;。\n\r\t')
 unresolved=[]
 if refs and re.sub(r'[、，,；;。\s]','',remainder):
  refs.append({'id':f'l{len(refs)+1:02d}','label':remainder,'law_name':'','article':'','ai_texts':[],
   'official_url':'https://law.moj.gov.tw/','official_link_is_specific':False,'unparsed':True})
  unresolved.append(remainder)
 return refs,unresolved

A11_LOAD_WEIGHT=0.88
READING_SPREAD_LIMIT=800
def reading_load(record:dict)->int:
 """Characters an expert has to judge: description, rationale, law text and cases."""
 n=len(record.get('description') or '')
 for scene in record.get('vlm') or []:
  n+=len((scene.get('危害情境推演') if isinstance(scene,dict) else '') or '')
 for hazard in record.get('hazards') or []:
  n+=len(hazard.get('law_text') or '')
  for law in hazard.get('laws') or []:
   for text in law.get('ai_texts') or []:n+=len(text or '')
  for case in hazard.get('cases') or []:n+=len(case.get('text') or '')
 return n
def assign_photos(index:list)->dict:
 """Disjoint groups of 30. Domain quotas stay 20/10, except A11 at 19/11.
 A01–A10 share judged text evenly; A11 is filled toward 88% of that load.
 Higher-hazard photos move off A11, then A01–A10 swap until their hazard counts
 differ by at most 10, while judged text stays within 800 characters."""
 experts=[f'A{i:02d}' for i in range(1,12)];others=experts[:-1]
 weight={e:(A11_LOAD_WEIGHT if e=='A11' else 1.0) for e in experts}
 caps={'營造':{e:(19 if e=='A11' else 20) for e in experts},'製造':{e:(11 if e=='A11' else 10) for e in experts}}
 by={p['id']:p for p in index}
 loads={e:0 for e in experts};counts={d:{e:0 for e in experts} for d in caps};groups={e:[] for e in experts}
 for photo in sorted(index,key=lambda p:(-p['reading_load'],p['id'])):
  eligible=[e for e in experts if counts[photo['domain']][e]<caps[photo['domain']][e]]
  chosen=min(eligible,key=lambda e:(loads[e]/weight[e],counts[photo['domain']][e],e))
  groups[chosen].append(photo['id']);loads[chosen]+=photo['reading_load'];counts[photo['domain']][chosen]+=1
 def judged(expert):return sum(by[i]['reading_load'] for i in groups[expert])
 def hazards(expert):return sum(by[i]['hazard_count'] for i in groups[expert])
 for _ in range(8):
  moved=False
  for pid in sorted(list(groups['A11']),key=lambda i:(-by[i]['hazard_count'],by[i]['reading_load'],i)):
   if hazards('A11')<=min(hazards(e) for e in others) and judged('A11')<min(judged(e) for e in others):break
   best=None
   dom=by[pid]['domain']
   current={e:judged(e) for e in others}
   a11=judged('A11')
   for expert in others:
    for qid in groups[expert]:
     if by[qid]['domain']!=dom or by[qid]['hazard_count']>=by[pid]['hazard_count']:continue
     new_a11=a11-by[pid]['reading_load']+by[qid]['reading_load']
     new_peer=current[expert]-by[qid]['reading_load']+by[pid]['reading_load']
     peer=[new_peer if e==expert else current[e] for e in others]
     if max(peer)-min(peer)>READING_SPREAD_LIMIT or new_a11>=min(peer):continue
     key=(by[pid]['hazard_count']-by[qid]['hazard_count'],min(peer)-new_a11,expert,qid)
     if best is None or key>best[0]:best=(key,expert,qid)
   if best is None:continue
   _,expert,qid=best
   groups['A11'].remove(pid);groups[expert].remove(qid)
   groups['A11'].append(qid);groups[expert].append(pid)
   moved=True
  if not moved:break
 for _ in range(30):
  current_h={e:hazards(e) for e in others};current_j={e:judged(e) for e in others}
  heavy=max(others,key=lambda e:(current_h[e],e));light=min(others,key=lambda e:(current_h[e],e))
  if current_h[heavy]-current_h[light]<=10:break
  best=None
  for pid in groups[heavy]:
   for qid in groups[light]:
    if by[pid]['domain']!=by[qid]['domain'] or by[pid]['hazard_count']<=by[qid]['hazard_count']:continue
    new_heavy=current_j[heavy]-by[pid]['reading_load']+by[qid]['reading_load']
    new_light=current_j[light]-by[qid]['reading_load']+by[pid]['reading_load']
    peer=[];peer_h=[]
    for expert in others:
     if expert==heavy:peer.append(new_heavy);peer_h.append(current_h[heavy]-by[pid]['hazard_count']+by[qid]['hazard_count'])
     elif expert==light:peer.append(new_light);peer_h.append(current_h[light]-by[qid]['hazard_count']+by[pid]['hazard_count'])
     else:peer.append(current_j[expert]);peer_h.append(current_h[expert])
    reduction=(current_h[heavy]-current_h[light])-(max(peer_h)-min(peer_h))
    if reduction<=0 or max(peer)-min(peer)>READING_SPREAD_LIMIT or judged('A11')>=min(peer) or hazards('A11')>min(peer_h):continue
    key=(reduction,-abs(new_heavy-new_light),pid,qid)
    if best is None or key>best[0]:best=(key,pid,qid)
  if best is None:break
  _,pid,qid=best
  groups[heavy].remove(pid);groups[light].remove(qid)
  groups[heavy].append(qid);groups[light].append(pid)
 order={p['id']:i for i,p in enumerate(index)}
 for ids in groups.values():ids.sort(key=order.get)
 assert all(len(ids)==30 for ids in groups.values())
 assert len(set(sum(groups.values(),[])))==len(index)==330
 rest=[judged(e) for e in others]
 assert judged('A11')<min(rest) and max(rest)-min(rest)<=READING_SPREAD_LIMIT
 assert sum(by[i]['hazard_count'] for i in groups['A11'])<=min(sum(by[i]['hazard_count'] for i in groups[e]) for e in others)
 return groups
def build(workbook:Path,images:Path,out:Path)->dict:
 wb=openpyxl.load_workbook(workbook,read_only=True,data_only=True)
 source_rows=list(wb.worksheets[0].iter_rows(values_only=True))
 rows=[dict(zip(source_rows[0],r)) for r in source_rows[1:] if any(v is not None for v in r)]
 image_files=[p for domain in ('營造','製造') for p in (images/domain).iterdir() if p.is_file() and p.suffix.lower() in ('.jpg','.jpeg','.png','.webp')]
 filenames=[p.name for p in image_files]
 if len(filenames)!=len(set(filenames)):raise ValueError('Duplicate image filename across domains')
 by_name={p.name:p for p in image_files}
 result_names=[r['OriginalFileName'] for r in rows]
 if len(result_names)!=len(set(result_names)):raise ValueError('Duplicate result filename')
 if set(result_names)!=set(by_name):raise ValueError(f'Result/image mismatch: {set(result_names)^set(by_name)}')
 source_hash=digest(workbook)
 image_hashes={name:digest(path) for name,path in by_name.items()}
 fingerprint=hashlib.sha256((source_hash+'\n'+'\n'.join(f'{n}:{image_hashes[n]}' for n in sorted(by_name))).encode()).hexdigest()
 dataset_id='vlm330-20261008-'+fingerprint[:12]
 index=[];unparsed=[]
 for excel_row,row in enumerate(rows,start=2):
  name=row['OriginalFileName'];path=by_name[name];photo_id=path.stem
  vlm=json.loads(row['VlmReportJson']);summary=json.loads(row['SummaryReportJson'])
  details=summary.get('法規詳情',[])
  hazards=[]
  for n,item in enumerate(summary['辨識結果']):
   law_text=item.get('違反法規','')
   refs,unresolved=split_refs(law_text,details)
   unparsed.extend({'photo_id':photo_id,'hazard_id':f'h{n+1:02d}','text':t} for t in unresolved)
   cases=[{'id':f'c{k+1:02d}','text':text,'source_status':'unconfirmed'} for k,text in enumerate(item.get('過去事故案例',[]))]
   hazards.append({'id':f'h{n+1:02d}','type':item['危害類型'],'law_text':law_text,'laws':refs,'cases':cases,
    'ppe':item.get('個人防護具',''),'improvements':item.get('建議改善方案',[]),
    'immediate_danger':item.get('立即發生危險之虞'),'source_pointer':f'/辨識結果/{n}'})
  record={'id':photo_id,'filename':name,'domain':path.parent.name,'image':'assets/photos/'+name,
   'image_sha256':image_hashes[name],'dataset_id':dataset_id,'identified_at':row['IdentifyTime'],'source_row':excel_row,
   'description':summary['整體描述'],'hazards':hazards,'overall_improvements':summary.get('整體改善建議',[]),
   'vlm':vlm.get('HazardItems',[]),'ai_law_details':details}
  write_json(out/'data/cases'/f'{photo_id}.json',record)
  image_out=out/'assets/photos'/name
  image_out.parent.mkdir(parents=True,exist_ok=True)
  if not image_out.exists() or digest(image_out)!=image_hashes[name]:shutil.copy2(path,image_out)
  index.append({'id':photo_id,'filename':name,'domain':path.parent.name,'image':record['image'],'image_sha256':image_hashes[name],
   'data_file':f'data/cases/{photo_id}.json','hazard_count':len(hazards),'hazard_types':[h['type'] for h in hazards],
   'case_count':sum(len(h['cases']) for h in hazards),'reading_load':reading_load(record)})
 index.sort(key=lambda r:(r['filename'][0],int(re.search(r'\d+',r['filename']).group()),r['filename']))
 assignments=assign_photos(index)
 assignment_version='disjoint30-'+hashlib.sha256(json.dumps(assignments,sort_keys=True,separators=(',',':')).encode()).hexdigest()[:12]
 manifest={'schema_version':2,'id':dataset_id,'title':'照片危害辨識專家審閱','test_date':'2026-10-08',
  'source_workbook':workbook.name,'source_workbook_sha256':source_hash,'fingerprint':fingerprint,
  'expert_ids':[f'A{i:02d}' for i in range(1,12)],'assignment':'disjoint_30_per_expert',
  'assignment_version':assignment_version,'assignments':assignments,'photos_per_expert':30,
  'photo_count':len(index),'domains':dict(Counter(r['domain'] for r in index)),
  'hazard_count':sum(r['hazard_count'] for r in index),'case_reference_count':sum(r['case_count'] for r in index),
  'hazard_types':HAZARD_TYPES,'law_baseline_date':'2026-10-08','case_sources':'unconfirmed',
  'photos':index}
 write_json(out/'data/manifest.json',manifest)
 write_assignments(manifest,out)
 write_json(out/'docs/import-report.json',{'dataset_id':dataset_id,'photo_count':len(index),'filename_matches':len(index),
  'hazard_count':manifest['hazard_count'],'case_reference_count':manifest['case_reference_count'],
  'unparsed_law_fragments':unparsed,'photo_copy_mode':'Original bytes, no crop, rotation or recompression',
  'metadata_source':'Actual revised photo files; stale index and manifest not used'})
 return {k:v for k,v in manifest.items() if k not in ('photos','hazard_types')}
def write_assignments(manifest:dict,out:Path)->None:
 photos={p['id']:p for p in manifest['photos']}
 lines=['# 固定分組：每位 30 張','',
  f"分組版本：{manifest['assignment_version']}。依待評閱讀量分配（整體描述、情境理由、法規條文、職災案例）。A01–A10 彼此相差在 800 字以內，A11 閱讀量最少。營造／製造仍是十組 20/10、A11 為 19/11。十一組互不重複，涵蓋 330 張。",'']
 for expert in manifest['expert_ids']:
  items=[photos[i] for i in manifest['assignments'][expert]]
  cons=sum(p['domain']=='營造' for p in items);mfg=sum(p['domain']=='製造' for p in items)
  lines+=[f'## {expert}','',
   f"30 張：營造 {cons} 張、製造 {mfg} 張；待評文字 {sum(p['reading_load'] for p in items):,} 字，危害 {sum(p['hazard_count'] for p in items)} 項。",'',
   f'[專家入口](https://fefe9487.github.io/vlm330-expert-review/?expert={expert})','',
   '、'.join(p['filename'] for p in items),'']
 (out/'docs/ASSIGNMENTS.md').write_text('\n'.join(lines),encoding='utf-8')
def reassign(out:Path)->dict:
 manifest=json.loads((out/'data/manifest.json').read_text(encoding='utf-8'))
 for photo in manifest['photos']:
  photo['reading_load']=reading_load(json.loads((out/photo['data_file']).read_text(encoding='utf-8')))
 manifest['assignments']=assign_photos(manifest['photos'])
 manifest['assignment_version']='disjoint30-'+hashlib.sha256(json.dumps(manifest['assignments'],sort_keys=True,separators=(',',':')).encode()).hexdigest()[:12]
 write_json(out/'data/manifest.json',manifest)
 write_assignments(manifest,out)
 photos={p['id']:p for p in manifest['photos']}
 return {e:{'reading_load':sum(photos[i]['reading_load'] for i in ids),'hazards':sum(photos[i]['hazard_count'] for i in ids),
  'construction':sum(photos[i]['domain']=='營造' for i in ids),'manufacturing':sum(photos[i]['domain']=='製造' for i in ids)}
  for e,ids in manifest['assignments'].items()}
if __name__=='__main__':
 sys.stdout.reconfigure(encoding='utf-8')
 parser=argparse.ArgumentParser()
 parser.add_argument('--workbook',type=Path,default=DEFAULT_PROJECT.parent/'sh168圖形辨識330筆結果.xlsx')
 parser.add_argument('--images',type=Path,default=DEFAULT_PROJECT.parents[1]/'危害辨識測試_330')
 parser.add_argument('--output',type=Path,default=DEFAULT_PROJECT)
 parser.add_argument('--reassign',action='store_true')
 args=parser.parse_args()
 if args.reassign:
  loads=reassign(args.output)
  version=json.loads((args.output/'data/manifest.json').read_text(encoding='utf-8'))['assignment_version']
  print(json.dumps({'assignment_version':version,'loads':loads},ensure_ascii=False,indent=2))
 else:print(json.dumps(build(args.workbook,args.images,args.output),ensure_ascii=False,indent=2))
