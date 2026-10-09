export class SaveConflict extends Error {constructor(){super('其他分頁已更新這張評分。請先匯出備份，再重新載入。');this.name='SaveConflict';}}
export class ReviewStore {
 constructor(namespace='production'){this.name=`vlm330-expert-review-${namespace}`;this.db=null;}
 async open(){
  this.db=await new Promise((resolve,reject)=>{const req=indexedDB.open(this.name,1);req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('reviews',{keyPath:['dataset_id','expert_id','photo_id']});db.createObjectStore('meta',{keyPath:'key'});db.createObjectStore('history',{keyPath:'id',autoIncrement:true});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('請關閉其他舊版分頁，再重新載入。'));});
  this.db.onversionchange=()=>this.db.close();return this;
 }
 async all(dataset,expert=null){const data=await this.request('reviews','readonly',s=>s.getAll());return data.filter(r=>r.dataset_id===dataset&&(!expert||r.expert_id===expert));}
 async get(dataset,expert,photo){return this.request('reviews','readonly',s=>s.get([dataset,expert,photo]));}
 async meta(key,value){if(arguments.length===1)return (await this.request('meta','readonly',s=>s.get(key)))?.value;await this.request('meta','readwrite',s=>s.put({key,value}));return value;}
 async request(store,mode,fn){return new Promise((resolve,reject)=>{const tx=this.db.transaction(store,mode);let result;const req=fn(tx.objectStore(store));req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||req.error);tx.onabort=()=>reject(tx.error||req.error);});}
 async save(record,expectedRevision=0){
  return new Promise((resolve,reject)=>{
   const tx=this.db.transaction(['reviews','history'],'readwrite'),store=tx.objectStore('reviews');let result,conflict=false;
   const req=store.get([record.dataset_id,record.expert_id,record.photo_id]);
   req.onsuccess=()=>{const old=req.result;if((old?.revision||0)!==expectedRevision){conflict=true;tx.abort();return;}
    result=structuredClone(record);result.revision=expectedRevision+1;result.updated_at=new Date().toISOString();
    if(old?.status==='submitted')tx.objectStore('history').add({record:old,saved_at:result.updated_at});
    store.put(result);
   };
   tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(conflict?new SaveConflict():tx.error||new Error('保存失敗，請匯出備份。'));
  });
 }
 async importRecords(records,replaceNewer=false){
  return new Promise((resolve,reject)=>{
   const tx=this.db.transaction(['reviews','history'],'readwrite'),store=tx.objectStore('reviews');const result={inserted:0,replaced:0,skipped:0};
   for(const r of records){const req=store.get([r.dataset_id,r.expert_id,r.photo_id]);req.onsuccess=()=>{const old=req.result;
    if(old&&(!replaceNewer||Date.parse(old.updated_at||old.created_at)>=Date.parse(r.updated_at||r.created_at))){result.skipped++;return;}
    const next=structuredClone(r);next.revision=(old?.revision||0)+1;
    if(old){tx.objectStore('history').add({record:old,saved_at:new Date().toISOString()});result.replaced++;}else result.inserted++;
    store.put(next);
   };}
   tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('匯入失敗，既有評分未變更。'));
  });
 }
}
