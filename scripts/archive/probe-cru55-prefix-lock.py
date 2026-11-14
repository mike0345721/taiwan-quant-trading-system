"""Isolated Windows feasibility probe. Never accepts an external source path."""
import ctypes as c
from ctypes import wintypes as w
import json
import pathlib
import subprocess
import tempfile
import sys

k = c.WinDLL('kernel32', use_last_error=True)
class Overlapped(c.Structure):
    _fields_ = [('Internal', c.c_size_t), ('InternalHigh', c.c_size_t),
                ('Offset', w.DWORD), ('OffsetHigh', w.DWORD), ('hEvent', w.HANDLE)]
k.CreateFileW.argtypes = [w.LPCWSTR,w.DWORD,w.DWORD,c.c_void_p,w.DWORD,w.DWORD,w.HANDLE]
k.CreateFileW.restype = w.HANDLE
k.LockFileEx.argtypes = [w.HANDLE,w.DWORD,w.DWORD,w.DWORD,w.DWORD,c.POINTER(Overlapped)]
k.CloseHandle.argtypes = [w.HANDLE]
k.CreateFileMappingW.argtypes = [w.HANDLE,c.c_void_p,w.DWORD,w.DWORD,w.DWORD,w.LPCWSTR]
k.CreateFileMappingW.restype = w.HANDLE
k.MapViewOfFile.argtypes = [w.HANDLE,w.DWORD,w.DWORD,w.DWORD,c.c_size_t]
k.MapViewOfFile.restype = c.c_void_p
k.UnmapViewOfFile.argtypes = [c.c_void_p]

with tempfile.TemporaryDirectory(prefix='cru55-prefix-probe-') as directory:
    p = pathlib.Path(directory) / 'fixture.ndjson'
    p.write_bytes(b'original\n')
    handle = k.CreateFileW(str(p), 0x80000000, 3, None, 3, 0, None)
    if handle == c.c_void_p(-1).value:
        raise c.WinError(c.get_last_error())
    overlap = Overlapped()
    if not k.LockFileEx(handle,1,0,9,0,c.byref(overlap)):
        raise c.WinError(c.get_last_error())
    mapping = None
    view = None
    if '--lock-only' not in sys.argv:
        mapping = k.CreateFileMappingW(handle,None,2,0,9,None)
        if not mapping:
            raise c.WinError(c.get_last_error())
        view = k.MapViewOfFile(mapping,4,0,0,9)
        if not view:
            raise c.WinError(c.get_last_error())
    try:
        code = r'''
const fs=require('fs'), p=process.argv[1], results=[];
for(const [name,op] of [
 ['append',()=>fs.appendFileSync(p,'appended\n',{encoding:'utf8',flag:'a'})],
 ['rewrite',()=>{let fd=fs.openSync(p,'r+');try{fs.writeSync(fd,Buffer.from('X'),0,1,0)}finally{fs.closeSync(fd)}}],
 ['rename',()=>fs.renameSync(p,p+'.moved')],
 ['truncate',()=>fs.truncateSync(p,0)]
]){try{op();results.push({name,success:true})}catch(e){results.push({name,success:false,code:e.code})}}
console.log(JSON.stringify({results,size:fs.statSync(p).size,bytes:fs.readFileSync(p,'utf8')}));
'''
        result = subprocess.run(['node','-e',code,str(p)],capture_output=True,text=True,check=True)
        print(result.stdout.strip())
    finally:
        if view:
            k.UnmapViewOfFile(view)
        if mapping:
            k.CloseHandle(mapping)
        k.CloseHandle(handle)
