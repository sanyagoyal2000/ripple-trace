type JsonRecord = Record<string, unknown>;
export type RippleActions = {
  getPolicyChange: () => unknown; listSystems: () => unknown; getSourceRecord: (id: string) => unknown;
  traceRequirement: () => unknown; analyzeImpact: () => unknown; listFindings: (severity?: string) => unknown;
  calculateReadiness: () => unknown; createReview: () => unknown; listProposals: () => unknown;
  explainFinding: (id: string) => unknown; approveProposal: (id: string) => unknown;
  rejectProposal: (id: string) => unknown; resetScenario: () => unknown;
};
type WebMCPTool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean }; execute: (input: Record<string, string>) => Promise<unknown> };
type ModelContext = { registerTool: (tool: WebMCPTool) => void | Promise<void>; getTools?: () => Promise<unknown[]> };
declare global { interface Window { __rippleActions?: RippleActions; __rippleRegistered?: boolean; rippleWebMCP?: { mode: 'native'|'localhost-shim'; listTools: () => Omit<WebMCPTool,'execute'>[]; callTool: (name:string,input?:Record<string,string>)=>unknown } } interface Document { modelContext?: ModelContext } }

const noInput = { type:'object', properties:{}, additionalProperties:false };
const idInput = { type:'object', properties:{ id:{ type:'string', description:'Exact RippleTrace finding, proposal, or source-record identifier.' } }, required:['id'], additionalProperties:false };
const severityInput = { type:'object', properties:{ severity:{ type:'string', enum:['critical','high','moderate','low','info'], description:'Optional exact severity filter.' } }, additionalProperties:false };

function ensureLocalModelContext(){
  if(document.modelContext || !['localhost','127.0.0.1'].includes(location.hostname)) return 'native' as const;
  const tools=new Map<string,WebMCPTool>(); document.modelContext={registerTool:(tool)=>{tools.set(tool.name,tool)}};
  window.rippleWebMCP={mode:'localhost-shim',listTools:()=>[...tools.values()].map(({execute:_,...tool})=>tool),callTool:(name,input={})=>{const tool=tools.get(name);if(!tool)throw new Error('Unknown WebMCP tool: '+name);return tool.execute(input)}};
  return 'localhost-shim' as const;
}
function activity(name:string,phase:'started'|'completed'|'failed',detail?:unknown){window.dispatchEvent(new CustomEvent('ripple:webmcp-activity',{detail:{name,phase,detail,at:new Date().toISOString()}}))}
async function invoke(name:string,run:()=>unknown){activity(name,'started');try{const output=await run();activity(name,'completed',output);return output}catch(error){activity(name,'failed',error instanceof Error?error.message:String(error));throw error}}

export function registerRippleTools(actions:RippleActions){
  window.__rippleActions=actions; const mode=ensureLocalModelContext(); const context=document.modelContext;
  if(!context||window.__rippleRegistered)return false;
  const readOnly={readOnlyHint:true,destructiveHint:false,idempotentHint:true};
  const mutating={readOnlyHint:false,destructiveHint:false,idempotentHint:true};
  const tool=(definition:Omit<WebMCPTool,'execute'>,run:(input:JsonRecord)=>unknown):WebMCPTool=>({...definition,execute:async(input)=>invoke(definition.name,()=>run(input))});
  const tools:WebMCPTool[]=[
    tool({name:'get_policy_change',title:'Get incoming policy change',description:'Return exact Confluence change AC2-CHG-2026-017 with before/after assertions, author, effective date, and authority state.',inputSchema:noInput,annotations:readOnly},()=>window.__rippleActions?.getPolicyChange()),
    tool({name:'list_connected_systems',title:'List connected enterprise systems',description:'List systems participating in the Wexler investigation with exact record counts and roles.',inputSchema:noInput,annotations:readOnly},()=>window.__rippleActions?.listSystems()),
    tool({name:'get_source_record',title:'Get one source-system record',description:'Retrieve one exact source record by stable entity ID, including native reference, structured fields, provenance, and related findings. Never invent an ID.',inputSchema:idInput,annotations:readOnly},({id})=>window.__rippleActions?.getSourceRecord(String(id))),
    tool({name:'trace_ac2_dependencies',title:'Trace AC-2 dependencies',description:'Return the bounded AC-2 policy-to-control-to-work-to-test-to-evidence dependency chain with provenance on every relationship.',inputSchema:noInput,annotations:readOnly},()=>window.__rippleActions?.traceRequirement()),
    tool({name:'analyze_change_impact',title:'Analyze AC-2 v3 impact',description:'Run deterministic assertion comparisons for AC-2 v2 to v3 and return compact counts with exact finding IDs. Changes no source record.',inputSchema:noInput,annotations:readOnly},()=>window.__rippleActions?.analyzeImpact()),
    tool({name:'list_impact_findings',title:'List grounded impact findings',description:'List exact findings and source-record IDs, optionally filtered by severity. Inspect records before recommending action.',inputSchema:severityInput,annotations:readOnly},({severity})=>window.__rippleActions?.listFindings(severity?String(severity):undefined)),
    tool({name:'explain_finding',title:'Explain one finding',description:'Explain one exact finding with its deterministic rule, expected assertion, observed assertion, and complete source-record citations.',inputSchema:idInput,annotations:readOnly},({id})=>window.__rippleActions?.explainFinding(String(id))),
    tool({name:'calculate_readiness',title:'Calculate assurance readiness',description:'Calculate the current weighted readiness score and component details from the scenario and human proposal decisions.',inputSchema:noInput,annotations:readOnly},()=>window.__rippleActions?.calculateReadiness()),
    tool({name:'create_impact_review',title:'Create draft remediation proposals',description:'Convert findings into individually reviewable draft proposals with exact IDs and targets. Creates drafts only; does not approve or write back.',inputSchema:noInput,annotations:mutating},()=>window.__rippleActions?.createReview()),
    tool({name:'list_remediation_proposals',title:'List remediation proposals',description:'Return proposal IDs, targets, risks, human decision state, and expected downstream effects.',inputSchema:noInput,annotations:readOnly},()=>window.__rippleActions?.listProposals()),
    tool({name:'approve_proposal',title:'Approve one selected proposal',description:'Record Dana Lindqvist’s approval for exactly one proposal. Invoke only after the user explicitly names its proposal ID.',inputSchema:idInput,annotations:mutating},({id})=>window.__rippleActions?.approveProposal(String(id))),
    tool({name:'reject_proposal',title:'Reject one selected proposal',description:'Record Dana Lindqvist’s rejection for exactly one proposal. Invoke only after the user explicitly names its proposal ID.',inputSchema:idInput,annotations:mutating},({id})=>window.__rippleActions?.rejectProposal(String(id))),
    tool({name:'reset_wexler_scenario',title:'Reset the Wexler scenario',description:'Reset this browser’s synthetic Wexler investigation to its initial unassessed state and clear local demo decisions.',inputSchema:noInput,annotations:mutating},()=>window.__rippleActions?.resetScenario()),
  ];
  window.__rippleRegistered=true;
  void Promise.all(tools.map((item)=>Promise.resolve(context.registerTool(item)))).then(()=>{document.documentElement.dataset.webmcpTools=String(tools.length);document.documentElement.dataset.webmcpMode=mode;window.dispatchEvent(new CustomEvent('ripple:webmcp-ready',{detail:{toolCount:tools.length,mode}}))}).catch((error)=>{window.__rippleRegistered=false;document.documentElement.dataset.webmcpError=error instanceof Error?error.message:String(error);console.error('[RippleTrace] WebMCP registration failed',error)});
  return true;
}
