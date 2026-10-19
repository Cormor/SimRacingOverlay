using System;
using System.Collections.Generic;

class TestTelemetrySourceSelection {
 static void Check(bool ok,string text){if(!ok)throw new Exception(text);}
 static void Main(){
  var native=new Dictionary<string,object>{{"available",true},{"speedKmh",204.78},{"gear",5},{"rpm",10531}};
  Func<object> forbidden=()=>{throw new Exception("A valid native sample must not consult a lower-priority source");};
  Check(object.ReferenceEquals(native,TelemetrySourceSelection.Select(()=>native,forbidden,forbidden)),"native UDP is authoritative, including recorded shift sample");
  var shared=new {available=true,gear=4,rpm=7000,speedKmh=100};
  Check(object.ReferenceEquals(shared,TelemetrySourceSelection.Select(()=>null,()=>shared,forbidden)),"valid shared memory cannot be vetoed by HTTP");
  int calls=0;var http=new {available=true,gear="6",rpm=9247,speedKmh=207.91,paused=true};
  Check(object.ReferenceEquals(http,TelemetrySourceSelection.Select(()=>null,()=>new {available=false},()=>{calls++;return http;}))&&calls==1,"HTTP only when both native readers are unavailable");
  Check(object.ReferenceEquals(native,TelemetrySourceSelection.Select(()=>native,forbidden,()=>http)),"native recovery immediately selects the complete native snapshot, not a merge");
  Check(TelemetrySourceSelection.Available(new {available=false})==false,"empty shared physics must not suppress fallback");
  Console.WriteLine("PASS: lazy authoritative UDP/shared memory; conflicting/stale HTTP cannot veto or enrich; unavailable-native fallback and native recovery.");
 }
}
