type RippleActions = { getGraph:()=>unknown; analyzeImpact:()=>unknown; calculateReadiness:()=>unknown; createReview:()=>unknown; explainFinding:(id:string)=>unknown; approveProposal:(id:string)=>unknown; rejectProposal:(id:string)=>unknown };
type WebMCPTool = { name:string; title:string; description:string; inputSchema:object; annotations:{readOnlyHint:boolean;destructiveHint?:boolean;idempotentHint?:boolean}; execute:(input:Record<string,string>)=>Promise<string> };
type ModelContext = { registerTool:(tool:WebMCPTool)=>void|Promise<void>; getTools?:()=>Promise<unknown[]> };
declare global { interface Window { __rippleActions?:RippleActions; __rippleRegistered?:boolean; rippleWebMCP?:{mode:'native'|'localhost-shim';listTools:()=>Omit<WebMCPTool,'execute'>[];callTool:(name:string,input?:Record<string,string>)=>unknown} } interface Document { modelContext?:ModelContext } }

const noInput={type:'object',properties:{},additionalProperties:false};
const idInput={type:'object',properties:{id:{type:'string',description:'Stable RippleTrace finding or proposal identifier'}},required:['id'],additionalProperties:false};
const result=(value:unknown)=>JSON.stringify(value);

function ensureLocalModelContext(){if(document.modelContext||!['localhost','127.0.0.1'].includes(location.hostname))return 'native' as const;const tools=new Map<string,WebMCPTool>();document.modelContext={registerTool:(tool)=>{tools.set(tool.name,tool)}};window.rippleWebMCP={mode:'localhost-shim',listTools:()=>[...tools.values()].map(({execute:_,...tool})=>tool),callTool:(name,input={})=>{const tool=tools.get(name);if(!tool)throw new Error('Unknown WebMCP tool: '+name);return tool.execute(input)}};return 'localhost-shim' as const}

export function registerRippleTools(actions:RippleActions){
  window.__rippleActions=actions;
  const mode=ensureLocalModelContext();
  const context=document.modelContext;
  if(!context||window.__rippleRegistered)return false;
  const readOnly={readOnlyHint:true,destructiveHint:false,idempotentHint:true};
  const reviewAction={readOnlyHint:false,destructiveHint:false,idempotentHint:true};
  const tools:WebMCPTool[]=[
    {name:'get_traceability_graph',title:'Get traceability graph',description:'Return the current Wexler Systems policy-to-evidence graph with source-system provenance.',inputSchema:noInput,annotations:readOnly,execute:async()=>result(window.__rippleActions?.getGraph())},
    {name:'analyze_change_impact',title:'Analyze policy change impact',description:'Compare proposed AC-2 v3 assertions with controls, tests, exceptions, evidence, and work. Derives findings and changes no source records.',inputSchema:noInput,annotations:readOnly,execute:async()=>result(window.__rippleActions?.analyzeImpact())},
    {name:'calculate_readiness',title:'Calculate assurance readiness',description:'Calculate the weighted assurance-readiness score and its component breakdown.',inputSchema:noInput,annotations:readOnly,execute:async()=>result(window.__rippleActions?.calculateReadiness())},
    {name:'create_impact_review',title:'Create impact review',description:'Turn derived findings into individually reviewable draft proposals. Does not approve or write back any proposal.',inputSchema:noInput,annotations:readOnly,execute:async()=>result(window.__rippleActions?.createReview())},
    {name:'explain_finding',title:'Explain an impact finding',description:'Explain the expected and observed assertions and exact source records that produced one finding.',inputSchema:idInput,annotations:readOnly,execute:async({id})=>result(window.__rippleActions?.explainFinding(id))},
    {name:'approve_proposal',title:'Approve a selected proposal',description:'Record approval of one selected draft proposal as the named human reviewer. Invoke only after explicit user selection.',inputSchema:idInput,annotations:reviewAction,execute:async({id})=>result(window.__rippleActions?.approveProposal(id))},
    {name:'reject_proposal',title:'Reject a selected proposal',description:'Record rejection of one selected draft proposal and preserve the human decision.',inputSchema:idInput,annotations:reviewAction,execute:async({id})=>result(window.__rippleActions?.rejectProposal(id))},
  ];
  window.__rippleRegistered=true;
  void Promise.all(tools.map((tool)=>Promise.resolve(context.registerTool(tool)))).then(()=>{document.documentElement.dataset.webmcpTools=String(tools.length);document.documentElement.dataset.webmcpMode=mode;window.dispatchEvent(new CustomEvent('ripple:webmcp-ready',{detail:{toolCount:tools.length,mode}}))}).catch((error)=>{window.__rippleRegistered=false;document.documentElement.dataset.webmcpError=error instanceof Error?error.message:String(error);console.error('[RippleTrace] WebMCP registration failed',error)});
  return true;
}
