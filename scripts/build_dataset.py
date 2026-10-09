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

def assign_photos(index:list)->dict:
 """Disjoint groups, balanced by domain and summary hazard count; frozen and deterministic."""
 experts=[f'A{i:02d}' for i in range(1,12)]
 groups={e:[] for e in experts};loads={e:0 for e in experts}
 # 219 construction + 111 manufacturing: ten 20/10 groups and one 19/11.
 for domain,capacities in [('營造',[20]*10+[19]),('製造',[10]*10+[11])]:
  counts={e:0 for e in experts}
  candidates=sorted((p for p in index if p['domain']==domain),key=lambda p:(-p['hazard_count'],p['id']))
  for photo in candidates:
   eligible=[e for i,e in enumerate(experts) if counts[e]<capacities[i]]
   chosen=min(eligible,key=lambda e:(loads[e],counts[e],e))
   groups[chosen].append(photo['id']);loads[chosen]+=photo['hazard_count'];counts[chosen]+=1
 order={p['id']:i for i,p in enumerate(index)}
 for ids in groups.values():ids.sort(key=order.get)
 assert all(len(ids)==30 for ids in groups.values())
 assert len(set(sum(groups.values(),[])))==len(index)==330
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
   'case_count':sum(len(h['cases']) for h in hazards)})
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
 write_json(out/'docs/import-report.json',{'dataset_id':dataset_id,'photo_count':len(index),'filename_matches':len(index),
  'hazard_count':manifest['hazard_count'],'case_reference_count':manifest['case_reference_count'],
  'unparsed_law_fragments':unparsed,'photo_copy_mode':'Original bytes, no crop, rotation or recompression',
  'metadata_source':'Actual revised photo files; stale index and manifest not used'})
 return {k:v for k,v in manifest.items() if k not in ('photos','hazard_types')}
if __name__=='__main__':
 sys.stdout.reconfigure(encoding='utf-8')
 parser=argparse.ArgumentParser()
 parser.add_argument('--workbook',type=Path,default=DEFAULT_PROJECT.parent/'sh168圖形辨識330筆結果.xlsx')
 parser.add_argument('--images',type=Path,default=DEFAULT_PROJECT.parents[1]/'危害辨識測試_330')
 parser.add_argument('--output',type=Path,default=DEFAULT_PROJECT)
 args=parser.parse_args()
 print(json.dumps(build(args.workbook,args.images,args.output),ensure_ascii=False,indent=2))
