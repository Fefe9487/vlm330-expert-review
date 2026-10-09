"""Check all exported photos and JSON without original source dependencies."""
from pathlib import Path
import hashlib,json,re,sys
root=Path(__file__).resolve().parents[1]
m=json.loads((root/'data/manifest.json').read_text(encoding='utf-8'))
assert m['photo_count']==len(m['photos'])==330
assert len(m['expert_ids'])==11 and len(set(m['expert_ids']))==11
assert len({p['id'] for p in m['photos']})==330
assigned=sum(m['assignments'].values(),[])
assert all(len(m['assignments'][id])==30 for id in m['expert_ids'])
assert len(assigned)==len(set(assigned))==330
assert set(assigned)=={p['id'] for p in m['photos']}
assert m['assignment']=='disjoint_30_per_expert'
hazards=cases=laws=0
for entry in m['photos']:
 p=json.loads((root/entry['data_file']).read_text(encoding='utf-8'))
 assert p['id']==entry['id'] and p['dataset_id']==m['id']
 assert p['image_sha256']==entry['image_sha256']==hashlib.sha256((root/p['image']).read_bytes()).hexdigest()
 assert len(p['hazards'])==entry['hazard_count']
 assert len({h['id'] for h in p['hazards']})==len(p['hazards'])
 for h in p['hazards']:
  assert len({v['id'] for v in h['laws']})==len(h['laws'])
  assert len({v['id'] for v in h['cases']})==len(h['cases'])
  assert all(l['official_url'].startswith('https://law.moj.gov.tw/') for l in h['laws'])
 hazards+=len(p['hazards']);cases+=sum(len(h['cases']) for h in p['hazards']);laws+=sum(len(h['laws']) for h in p['hazards'])
assert hazards==m['hazard_count']==1285
assert cases==m['case_reference_count']==2375
for p in (root/'js').glob('*.js'):
 text=p.read_text(encoding='utf-8')
 assert not re.search(r'(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|D:\\\\|F:\\\\)',text)
print(json.dumps({'photos':330,'experts':11,'hazards':hazards,'case_references':cases,'law_rating_items':laws,'original_image_hashes':'all_match','dataset_id':m['id']},ensure_ascii=False))
