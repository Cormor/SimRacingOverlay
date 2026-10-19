using System;
using System.Collections.Generic;

// Each reader validates its own protocol, session and freshness. A slower reader
// cannot veto or enrich a valid higher-priority sample. Providers are lazy.
static class TelemetrySourceSelection {
 public static bool Available(object sample) {
  if(sample==null)return false;
  var map=sample as Dictionary<string,object>;object value;
  if(map!=null)return map.TryGetValue("available",out value)&&object.Equals(value,true);
  var property=sample.GetType().GetProperty("available");
  return property!=null&&object.Equals(property.GetValue(sample,null),true);
 }
 public static object Select(Func<object> udp,Func<object> sharedMemory,Func<object> fallback) {
  var sample=udp();if(Available(sample))return sample;
  sample=sharedMemory();if(Available(sample))return sample;
  return fallback();
 }
}
