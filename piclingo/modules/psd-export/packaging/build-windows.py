from pathlib import Path
import shutil,json,ctypes,struct

root=Path(__file__).resolve().parents[3]
work=root/'work'
destination=(work/'desktop-dist-v1.2/PicLingo').resolve()
assert destination.is_relative_to(work.resolve())
if destination.exists(): raise RuntimeError('Build directory already exists; inspect it before rebuilding.')
electron=work/'electron-runtime/node_modules/electron/dist'
worker=work/'worker-dist/PicLingoWorker'
shutil.copytree(electron,destination)
assert (destination/'electron.exe').resolve().is_relative_to(destination)
(destination/'electron.exe').rename(destination/'PicLingo.exe')
ui=root/'outputs/PicLingo-Liquid-Glass'
app=destination/'resources/app';app.mkdir(parents=True)
for name in ['index.html','styles.css','app.js','desktop-bridge.js','package.json']:
 shutil.copy2(ui/name,app/name)
shutil.copytree(ui/'electron',app/'electron')
shutil.copytree(ui/'modules',app/'modules')
shutil.copytree(root/'modules/psd-export/release/worker-dist/PicLingoPSD',destination/'resources/psd')
(app/'assets').mkdir()
for name in ['app.png','app.ico','qa-zh.png']:shutil.copy2(ui/'assets'/name,app/'assets'/name)
(app/'tests').mkdir()
shutil.copy2(ui/'tests/inspect-dwm.ps1',app/'tests/inspect-dwm.ps1')
shutil.copytree(worker,destination/'resources/backend')
shutil.copytree(work/'licenses',destination/'licenses')
shutil.copytree(root/'modules/psd-export/packaging/licenses',destination/'licenses/psd')
for name in ['LICENSE.txt','THIRD-PARTY-NOTICES.md','dependencies.txt']:
 shutil.copy2(work/name,destination/name)
(destination/'assets').mkdir()
shutil.copy2(work/'assets/app.ico',destination/'assets/app.ico')

# 仅为本次复制的程序写入原有图标资源。
exe=destination/'PicLingo.exe'
assert exe.resolve().is_relative_to(destination)
raw=(work/'assets/app.ico').read_bytes()
_,kind,count=struct.unpack_from('<HHH',raw)
assert kind==1
kernel=ctypes.WinDLL('kernel32',use_last_error=True)
kernel.BeginUpdateResourceW.argtypes=[ctypes.c_wchar_p,ctypes.c_bool];kernel.BeginUpdateResourceW.restype=ctypes.c_void_p
kernel.UpdateResourceW.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_ushort,ctypes.c_void_p,ctypes.c_uint];kernel.UpdateResourceW.restype=ctypes.c_bool
kernel.EndUpdateResourceW.argtypes=[ctypes.c_void_p,ctypes.c_bool];kernel.EndUpdateResourceW.restype=ctypes.c_bool
handle=kernel.BeginUpdateResourceW(str(exe),False)
if not handle:raise ctypes.WinError(ctypes.get_last_error())
def resource(kind,identity,data):
 buffer=ctypes.create_string_buffer(data)
 if not kernel.UpdateResourceW(handle,ctypes.c_void_p(kind),ctypes.c_void_p(identity),1033,buffer,len(data)):raise ctypes.WinError(ctypes.get_last_error())
group=struct.pack('<HHH',0,1,count)
try:
 for i in range(count):
  width,height,colors,reserved,planes,bits,size,offset=struct.unpack_from('<BBBBHHII',raw,6+16*i)
  identity=100+i
  resource(3,identity,raw[offset:offset+size])
  group+=struct.pack('<BBBBHHIH',width,height,colors,reserved,planes,bits,size,identity)
 resource(14,1,group)
 if not kernel.EndUpdateResourceW(handle,False):raise ctypes.WinError(ctypes.get_last_error())
except:
 kernel.EndUpdateResourceW(handle,True)
 raise
files=[p for p in destination.rglob('*') if p.is_file()]
print(json.dumps({'directory':str(destination),'files':len(files),'unpackedBytes':sum(p.stat().st_size for p in files)},indent=2))
