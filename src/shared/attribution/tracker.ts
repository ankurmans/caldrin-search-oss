/**
 * The tracker snippet served at /t.js. It runs on a customer's own site and
 * records where a visit came from, never anything typed into a page. It does
 * nothing for a browser that sends Do Not Track or Global Privacy Control, and
 * with consent "required" it stays silent until the site calls
 * caldrin("consent", true). The visitor id is a first-party cookie holding a
 * random id; there is no fingerprinting. Only campaign tags and one click id
 * are sent from a URL, and a referrer is sent without its query string.
 */
export const TRACKER_SCRIPT = `(function(){
var s=document.currentScript;if(!s)return;
var key=s.getAttribute("data-key");if(!key)return;
var mode=s.getAttribute("data-consent")==="implied"?"implied":"required";
var decorate=(s.getAttribute("data-decorate")||"").split(",").map(function(h){return h.trim().toLowerCase()}).filter(Boolean);
var cookieDomain=s.getAttribute("data-cookie-domain");
var endpoint=new URL(s.src).origin+"/api/attribution/collect";
var nav=navigator;
if(nav.globalPrivacyControl||nav.doNotTrack==="1"||window.doNotTrack==="1")return;
var granted=mode==="implied",queue=[],ready=false,lastPath=null,visitor=null;
var TAGS=["utm_source","utm_medium","utm_campaign","utm_term","utm_content","gclid","gbraid","wbraid","msclkid","fbclid","ttclid","li_fat_id"];
function rnd(){if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();var a=new Uint8Array(16);crypto.getRandomValues(a);return Array.prototype.map.call(a,function(b){return(b<16?"0":"")+b.toString(16)}).join("")}
function get(n){var m=document.cookie.match(new RegExp("(?:^|; )"+n+"=([^;]*)"));return m?decodeURIComponent(m[1]):null}
function set(n,v,secs){var c=n+"="+encodeURIComponent(v)+"; Max-Age="+secs+"; Path=/; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"")+(cookieDomain?"; Domain="+cookieDomain:"");document.cookie=c}
function cleanUrl(){var u=new URL(location.href),k=new URLSearchParams();TAGS.forEach(function(t){var v=u.searchParams.get(t);if(v)k.set(t,v)});var q=k.toString();return u.origin+u.pathname+(q?"?"+q:"")}
function cleanRef(){try{var r=new URL(document.referrer);return r.origin+r.pathname}catch(e){return ""}}
function send(ev){queue.push(ev);flush()}
function flush(){if(!granted||!ready||!queue.length)return;var body=JSON.stringify({k:key,events:queue.splice(0,20)});
if(nav.sendBeacon&&nav.sendBeacon(endpoint,body))return;
fetch(endpoint,{method:"POST",body:body,keepalive:true,headers:{"content-type":"text/plain"}}).catch(function(){})}
function base(type,extra){var e={id:rnd(),type:type,t:Date.now(),vid:visitor,sid:get("_cldr_sid")||undefined,url:cleanUrl()};for(var k in extra)e[k]=extra[k];return e}
function startSession(){var sig=cleanUrl().split("?")[1]||"",prev=get("_cldr_c");
var fresh=!get("_cldr_sid")||(sig&&sig!==prev);
set("_cldr_sid",get("_cldr_sid")||rnd(),1800);
if(fresh){set("_cldr_sid",rnd(),1800);if(sig)set("_cldr_c",sig,1800);send(base("session_start",{ref:cleanRef()}))}
else set("_cldr_sid",get("_cldr_sid"),1800)}
function pageView(){var p=location.pathname;if(p===lastPath)return;lastPath=p;send(base("page_view"))}
function adopt(){var u=new URL(location.href),x=u.searchParams.get("_cldr");if(!x)return null;u.searchParams.delete("_cldr");history.replaceState(null,"",u.pathname+(u.search||"")+u.hash);return x}
function begin(){if(ready)return;var adopted=adopt();visitor=adopted||get("_cldr_vid")||rnd();set("_cldr_vid",visitor,34128000);ready=true;startSession();pageView();flush()}
function hook(n){var o=history[n];history[n]=function(){var r=o.apply(this,arguments);setTimeout(pageView,0);return r}}
hook("pushState");hook("replaceState");window.addEventListener("popstate",function(){setTimeout(pageView,0)});
if(decorate.length)document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a||!visitor||!granted)return;try{var u=new URL(a.href);if(decorate.indexOf(u.hostname.toLowerCase())>-1){u.searchParams.set("_cldr",visitor);a.href=u.toString()}}catch(x){}},true);
function api(cmd,a){
if(cmd==="consent"){granted=!!a;if(granted){begin()}else{queue=[]}return}
if(!granted)return;
if(cmd==="test"&&ready)send(base("page_view",{test:true}))}
var pre=window.caldrin&&window.caldrin.q||[];
window.caldrin=function(){api.apply(null,arguments)};
if(granted)begin();
pre.forEach(function(c){api.apply(null,c)});
})();
`;
