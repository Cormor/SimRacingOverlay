obs=obslua
local root=''
local name='SimRacingOverlay'
local legacy_name='MOZA CS Pro 实时方向盘'
local function browser_source()
 return obs.obs_get_source_by_name(name) or obs.obs_get_source_by_name(legacy_name)
end
local function read_json(file)
 local f=io.open(root..file,'r');if not f then return nil end
 local data=obs.obs_data_create_from_json(f:read('*a'));f:close();return data
end
local function url(port)
 return 'http://127.0.0.1:'..port..'/'
end
local function initial_url()
 local cfg=read_json('settings.json');local port=18764
 if cfg then local configured=obs.obs_data_get_int(cfg,'httpPort');if configured>0 and configured<=65535 then port=configured end;obs.obs_data_release(cfg) end
 return url(port)
end
function sync()
 local state=read_json('runtime/obs-state.json');if not state then return end
 local port=obs.obs_data_get_int(state,'port')
 local revision=obs.obs_data_get_string(state,'revision')
 local width,height=obs.obs_data_get_int(state,'width'),obs.obs_data_get_int(state,'height')
 obs.obs_data_release(state)
 if port<1 or port>65535 or not revision:match('^[0-9a-f]+%-%d+$') then return end
 local source=browser_source();if not source then return end
 local settings=obs.obs_source_get_settings(source)
 if width<1 or height<1 then
  local info=obs.obs_video_info()
  if obs.obs_get_video_info(info) then width=info.base_width;height=info.base_height
  else width=obs.obs_data_get_int(settings,'width');height=obs.obs_data_get_int(settings,'height') end
 end
 local current=obs.obs_data_get_string(settings,'url')
 local page=current:match('[?&]page=([12])')
 local target=url(port)..'?sro='..revision..(page and '&page='..page or '')
 if obs.obs_data_get_int(settings,'width')~=width or obs.obs_data_get_int(settings,'height')~=height or current~=target then obs.obs_data_set_int(settings,'width',width);obs.obs_data_set_int(settings,'height',height);obs.obs_data_set_string(settings,'url',target);obs.obs_source_update(source,settings) end
 obs.obs_data_release(settings);obs.obs_source_release(source)
end
local function start_overlay(args)
 os.execute('start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'..root..'Start-Overlay.ps1" -FromHost'..args)
end
function start() start_overlay('') end
function add()
 local scene=obs.obs_frontend_get_current_scene();if not scene then return end
 local handle=obs.obs_scene_from_source(scene)
 if not obs.obs_scene_find_source(handle,name) and not obs.obs_scene_find_source(handle,legacy_name) then
  local source=browser_source()
  if not source then local settings=obs.obs_data_create();obs.obs_data_set_string(settings,'url',initial_url());obs.obs_data_set_int(settings,'width',1920);obs.obs_data_set_int(settings,'height',1080);obs.obs_data_set_bool(settings,'shutdown',false);obs.obs_data_set_bool(settings,'fps_custom',true);obs.obs_data_set_int(settings,'fps',60);source=obs.obs_source_create('browser_source',name,settings,nil);obs.obs_data_release(settings) end
  if source then obs.obs_scene_add(handle,source);obs.obs_source_release(source) end
 end
 obs.obs_source_release(scene);sync()
end
function edit() start_overlay(' -OpenLayout') end
function script_description() return 'SimRacingOverlay: starts with OBS. Edit individual controls on the desktop; the same layout is shown in this browser source.' end
function script_properties() local p=obs.obs_properties_create();obs.obs_properties_add_button(p,'start','启动叠加',start);obs.obs_properties_add_button(p,'add','添加到当前场景',add);obs.obs_properties_add_button(p,'edit','打开桌面布局编辑',edit);return p end
function script_load(settings)
 root=script_path();start()
 local source=browser_source()
 if source then obs.obs_source_release(source);sync() else add() end
 obs.timer_add(sync,2500)
end
function script_unload() obs.timer_remove(sync) end
