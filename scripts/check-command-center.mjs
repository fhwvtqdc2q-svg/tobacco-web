import fs from "node:fs";
import vm from "node:vm";
const source=fs.readFileSync(new URL("../src/command-center.js",import.meta.url),"utf8");
const allowedRoutes=new Set();
const app={innerHTML:"",querySelectorAll:()=>[],querySelector:()=>null};
const document={querySelector:()=>null,querySelectorAll:()=>[],createElement:(tag)=>({tagName:String(tag).toUpperCase(),dataset:{},addEventListener:()=>{}})};
const window={location:{search:""},addEventListener:()=>{},ozkCanAccessRoute:()=>false};
const testConsole={...console,warn:()=>{},error:()=>{}};
const context={console:testConsole,Date,Math,Number,String,Array,Object,Promise,URLSearchParams,setTimeout:()=>0,setInterval:()=>0,clearInterval:()=>{},window,document,allowedRoutes,state:{route:"overview",session:null},app,shell:(x)=>x,render:()=>{},setRoute:()=>{}};
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
if(!source.includes("Promise.allSettled"))throw new Error("Ameen Live resources must tolerate partial failure");
if(source.includes("Promise.all([window.ozkAmeenLive.health()"))throw new Error("Ameen Live resources must not share a fail-fast Promise.all");

context.state.session={id:"contract-test"};
const health={ok:true};
const stock={asOf:new Date().toISOString(),rowCount:1,rows:[{item_guid:"22222222-2222-4222-8222-222222222222",stock_qty:4}]};
const customers={asOf:new Date().toISOString(),rowCount:1,rows:[{customer_guid:"33333333-3333-4333-8333-333333333333"}]};
const pass=(value)=>async()=>value;
const fail=(name)=>async()=>{throw new Error(`${name} failed`);};
async function refreshWith(resources){
  window.ozkAmeenLive=resources;
  await window.ozkCommandCenter.refreshFromAmeen();
  return window.ozkAmeenLiveCache;
}

const allPass=await refreshWith({health:pass(health),stock:pass(stock),customers:pass(customers)});
if(allPass?.health!==health||allPass?.stock!==stock||allPass?.customers!==customers||Number.isNaN(Date.parse(allPass.updatedAt)))throw new Error("A: all successful Ameen Live resources must be cached");

const healthFails=await refreshWith({health:fail("health"),stock:pass(stock),customers:pass(customers)});
if(healthFails?.health!==null||healthFails?.stock!==stock||healthFails?.customers!==customers)throw new Error("B: health failure must not discard successful stock");

const customersFail=await refreshWith({health:pass(health),stock:pass(stock),customers:fail("customers")});
if(customersFail?.health!==health||customersFail?.stock!==stock||customersFail?.customers!==null)throw new Error("C: customers failure must not discard successful stock");

const diagnosticsFail=await refreshWith({health:fail("health"),stock:pass(stock),customers:fail("customers")});
if(diagnosticsFail?.health!==null||diagnosticsFail?.stock!==stock||diagnosticsFail?.customers!==null)throw new Error("D/G: partial success must retain stock without throwing");

window.ozkAmeenLiveCache=Object.freeze({stock,updatedAt:new Date().toISOString()});
const stockFails=await refreshWith({health:pass(health),stock:fail("stock"),customers:pass(customers)});
if(stockFails?.health!==health||stockFails?.stock!==null||stockFails?.customers!==customers)throw new Error("E: failed stock must be cleared while other successful resources are retained");
if(Object.prototype.hasOwnProperty.call(stockFails,"stockAsOf"))throw new Error("E: failed stock must not invent stockAsOf freshness");
console.log("OZK Command Center contract: OK");
