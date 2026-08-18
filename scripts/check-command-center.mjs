import fs from "node:fs";
import vm from "node:vm";
const source=fs.readFileSync(new URL("../src/command-center.js",import.meta.url),"utf8");
const allowedRoutes=new Set();
const app={innerHTML:"",querySelectorAll:()=>[],querySelector:()=>null};
const document={querySelector:()=>null,createElement:(tag)=>({tagName:String(tag).toUpperCase(),dataset:{},addEventListener:()=>{}})};
const window={location:{search:""},addEventListener:()=>{}};
const context={console,Date,Math,Number,String,Array,Object,Promise,URLSearchParams,setTimeout:()=>0,setInterval:()=>0,clearInterval:()=>{},window,document,allowedRoutes,state:{route:"overview",session:null},app,shell:(x)=>x,render:()=>{},setRoute:()=>{}};
context.globalThis=context;vm.createContext(context);vm.runInContext(source,context,{filename:"command-center.js"});
if(!window.ozkCommandCenter?.answerQuestion||!window.ozkCommandCenter?.refresh)throw new Error("Command Center API missing");
const duplicateGuid="11111111-1111-4111-8111-111111111111";
if(window.ozkCommandCenter.dedupeRecommendations([{itemGuid:duplicateGuid},{itemGuid:duplicateGuid.toLowerCase()}]).length!==1)throw new Error("Command Center must emit at most one recommendation per canonical GUID");
if(!allowedRoutes.has("command"))throw new Error("Command route not registered");
const emptyAnswer=window.ozkCommandCenter.answerQuestion("today");
if(emptyAnswer!==null)throw new Error("Command Center should not answer before executive brief is loaded");
for (const label of ["رقم الصنف:", "حالة المخزون:", "الوحدة الأولى:", "الوحدة الثانية:", "حالة الحركة:", "المخزون الحالي غير محدث؛ الكميات الرقمية معطلة."]) {
  if (!source.includes(label)) throw new Error(`Purchase recommendation display is missing: ${label}`);
}
for (const file of ["supabase-client.js", "supplier-obligations-client.js", "web-push.js", "ameen-live-client.js"]) {
  const clientSource = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  if (!clientSource.includes("window.ozkSupabaseClient")) throw new Error(`${file} does not reuse the canonical Supabase browser client`);
}
console.log("OZK Command Center contract: OK");
