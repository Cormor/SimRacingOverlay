obs=obslua
local root=''
local name='SimRacingOverlay'
local function read_json(file)
 local f=io.open(root..file,'r');if not f then return nil end
 local data=obs.obs_data_create_from_json(f:read('*a'));f:close();return data
end
local function url()
 local cfg=read_json('settings.json');local port=18764
 if cfg then port=obs.obs_data_get_int(cfg,'httpPort');obs.obs_data_release(cfg) end
 return 'http://127.0.0.1:'..port..'/'
end
function sync()
 local source=obs.obs_get_source_by_name(name);if not source then return end
 local layout=read_json('assets/layout.json');local width,height=0,0
 if layout then local stage=obs.obs_data_get_obj(layout,'stage');if stage then width=obs.obs_data_get_int(stage,'monitorPixelWidth');height=obs.obs_data_get_int(stage,'monitorPixelHeight');obs.obs_data_release(stage) end;obs.obs_data_release(layout) end
 if width<1 or height<1 then local info=obs.obs_video_info();if obs.obs_get_video_info(info) then width=info.base_width;height=info.base_height end end
 local settings=obs.obs_source_get_settings(source)
 if obs.obs_data_get_int(settings,'width')~=width or obs.obs_data_get_int(settings,'height')~=height or obs.obs_data_get_string(settings,'url')~=url() then obs.obs_data_set_int(settings,'width',width);obs.obs_data_set_int(settings,'height',height);obs.obs_data_set_string(settings,'url',url());obs.obs_source_update(source,settings) end
 obs.obs_data_release(settings);obs.obs_source_release(source)
end
function start()
 os.execute('start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'..root..'Start-Overlay.ps1" -FromHost')
end
function add()
 local scene=obs.obs_frontend_get_current_scene();if not scene then return end
 local handle=obs.obs_scene_from_source(scene)
 if not obs.obs_scene_find_source(handle,name) then
  local source=obs.obs_get_source_by_name(name)
  if not source then local settings=obs.obs_data_create();obs.obs_data_set_string(settings,'url',url());obs.obs_data_set_int(settings,'width',1920);obs.obs_data_set_int(settings,'height',1080);obs.obs_data_set_bool(settings,'shutdown',false);obs.obs_data_set_bool(settings,'fps_custom',true);obs.obs_data_set_int(settings,'fps',60);source=obs.obs_source_create('browser_source',name,settings,nil);obs.obs_data_release(settings) end
  if source then obs.obs_scene_add(handle,source);obs.obs_source_release(source) end
 end
 obs.obs_source_release(scene);sync()
end
function edit()
 local d=read_json('runtime/desktop.json');if not d then return end
 obs.obs_data_set_bool(d,'edit',not obs.obs_data_get_bool(d,'edit'));local f=io.open(root..'runtime/desktop.json','w');if f then f:write(obs.obs_data_get_json(d));f:close() end;obs.obs_data_release(d)
end
function script_description() return 'SimRacingOverlay: starts with OBS. Edit individual controls on the desktop; the same layout is shown in this browser source.' end
function script_properties() local p=obs.obs_properties_create();obs.obs_properties_add_button(p,'start','启动叠加',start);obs.obs_properties_add_button(p,'add','添加到当前场景',add);obs.obs_properties_add_button(p,'edit','开关桌面布局编辑',edit);return p end
function script_load(settings) root=script_path();start();add();obs.timer_add(sync,1500) end
function script_unload() obs.timer_remove(sync) end
