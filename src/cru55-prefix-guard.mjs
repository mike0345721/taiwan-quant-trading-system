import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {assertPlainPath} from './cvd-observation-isolation.mjs';

// The lease is process-local, never restored from disk. Normal WriteFile/CRT
// writers are supported; writable mapped I/O is explicitly outside this contract.
const leases=new Map();
let api;
function native(){
  if(api)return api;
  if(process.platform!=='win32')throw Error('STREAM_PREFIX_WINDOWS_REQUIRED');
  const koffi=createRequire(import.meta.url)('koffi'),k=koffi.load('kernel32.dll');
  const call=(name,result,args)=>k.func('__stdcall',name,result,args);
  api={
    open:call('CreateFileW','intptr_t',['str16','uint32','uint32','void *','uint32','uint32','intptr_t']),
    lock:call('LockFileEx','int',['intptr_t','uint32','uint32','uint32','uint32','void *']),
    unlock:call('UnlockFileEx','int',['intptr_t','uint32','uint32','uint32','void *']),
    mapping:call('CreateFileMappingW','intptr_t',['intptr_t','void *','uint32','uint32','uint32','str16']),
    map:call('MapViewOfFile','void *',['intptr_t','uint32','uint32','uint32','size_t']),
    unmap:call('UnmapViewOfFile','int',['void *']),
    close:call('CloseHandle','int',['intptr_t']),
    info:call('GetFileInformationByHandle','int',['intptr_t','void *']),
    volume:call('GetVolumeInformationByHandleW','int',['intptr_t','void *','uint32','void *','void *','void *','void *','uint32']),
    error:call('GetLastError','uint32',[]),
  };
  return api;
}
function failed(a,code){throw Error(code+':'+a.error());}
function checkHandle(a,h,binding,end){
  const info=Buffer.alloc(52);if(!a.info(h,info))failed(a,'STREAM_PREFIX_HANDLE');
  const ino=(BigInt(info.readUInt32LE(44))<<32n)|BigInt(info.readUInt32LE(48));
  const size=(BigInt(info.readUInt32LE(32))<<32n)|BigInt(info.readUInt32LE(36));
  if(String(info.readUInt32LE(28))!==binding.dev||String(ino)!==binding.ino||info.readUInt32LE(40)!==1||size<BigInt(end))throw Error('STREAM_PREFIX_SOURCE_CHANGED');
}
function check(lease){
  const s=fs.statSync(assertPlainPath(lease.file),{bigint:true});
  if(String(s.dev)!==lease.binding.dev||String(s.ino)!==lease.binding.ino||String(s.birthtimeNs)!==lease.binding.birthtimeNs||s.nlink!==1n||s.size<BigInt(lease.end))throw Error('STREAM_PREFIX_SOURCE_CHANGED');
  checkHandle(native(),lease.handle,lease.binding,lease.end);
  return lease.id;
}
export function releasePrefixGuards(group){
  const entries=leases.get(group);if(!entries)return;
  leases.delete(group);
  const a=native();
  for(const lease of entries.values()){
    a.unmap(lease.view);a.close(lease.mapping);
    a.unlock(lease.handle,0,lease.end>>>0,Math.floor(lease.end/2**32),lease.overlap);
    a.close(lease.handle);
  }
}
export function protectPrefix(group,slot,binding,end){
  if(!Number.isSafeInteger(end)||end<1)throw Error('STREAM_PREFIX_CUTOFF_INVALID');
  const file=assertPlainPath(binding.path);
  if(!/^[A-Za-z]:[\\/]/.test(file))throw Error('STREAM_PREFIX_LOCAL_VOLUME_REQUIRED');
  const entries=leases.get(group)??new Map(),old=entries.get(slot);
  if(old){
    if(old.file!==file||old.end!==end||JSON.stringify(old.binding)!==JSON.stringify(binding))throw Error('STREAM_PREFIX_LEASE_BINDING_CHANGED');
    return check(old);
  }
  const a=native(),handle=a.open(file,0x80000000,3,null,3,0,0);
  if(handle===-1||handle===-1n)failed(a,'STREAM_PREFIX_OPEN');
  let mapping=0,view=null,locked=false;
  const overlap=Buffer.alloc(process.arch==='ia32'?20:32);
  try{
    checkHandle(a,handle,binding,end);
    const filesystem=Buffer.alloc(64);
    if(!a.volume(handle,null,0,null,null,null,filesystem,32))failed(a,'STREAM_PREFIX_VOLUME');
    if(filesystem.toString('utf16le').replace(/\0.*$/s,'')!=='NTFS')throw Error('STREAM_PREFIX_NTFS_REQUIRED');
    // Shared [0,N) lock allows other readers and suffix writes. No DELETE
    // sharing pins the file identity. A read-only mapped section pins EOF.
    if(!a.lock(handle,1,0,end>>>0,Math.floor(end/2**32),overlap))failed(a,'STREAM_PREFIX_LOCK');
    locked=true;
    mapping=a.mapping(handle,null,2,Math.floor(end/2**32),end>>>0,null);
    if(!mapping)failed(a,'STREAM_PREFIX_MAPPING');
    view=a.map(mapping,4,0,0,1); // one byte of virtual address space, never read
    if(!view)failed(a,'STREAM_PREFIX_MAP_VIEW');
    const lease={id:crypto.randomUUID(),file,binding,end,handle,mapping,view,overlap};
    check(lease);entries.set(slot,lease);leases.set(group,entries);return lease.id;
  }catch(error){
    if(view)a.unmap(view);if(mapping)a.close(mapping);
    if(locked)a.unlock(handle,0,end>>>0,Math.floor(end/2**32),overlap);
    a.close(handle);throw error;
  }
}
export function assertPrefixProtected(group,slot,id){
  const lease=leases.get(group)?.get(slot);
  if(!lease||lease.id!==id)throw Error('STREAM_PREFIX_LEASE_LOST');
  check(lease);return true;
}
