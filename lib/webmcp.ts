type RippleActions = { getGraph:()=>unknown; analyzeImpact:()=>unknown; calculateReadiness:()=>unknown; createReview:()=>unknown; explainFinding:(id:string)=>unknown; approveProposal:(id:string)=>unknown; rejectProposal:(id:string)=>unknown };
declare global { interface Window { __rippleActions?:RippleActions; __rippleRegistered?:boolean } interface Document { modelContext?:{registerTool:(tool:{name:string;description:string;inputSchema:object;execute:(input:Record<string,string>)=>unknown})=>void} } }
const noInput={type:'object',properties:{}}; const idInput={type:'object',properties:{id:{type:'string',description:'Stable RippleTrace finding or proposal identifier'}},required:['id']};
export function registerRippleTools(actions:RippleActions){window.__rippleActions=actions;if(!document.modelContext||window.__rippleRegistered)return false;const r=(name:string,description:string,inputSchema:object,execute:(i:Record<string,string>)=>unknown)=>document.modelContext?.registerTool({name,description,inputSchema,execute});
  r('get_traceability_graph','Return the current Wexler Systems policy-to-evidence graph with source-system provenance. Read-only.',noInput,()=>window.__rippleActions?.getGraph());
  r('analyze_change_impact','Deterministically compare proposed AC-2 v3 assertions with controls, tests, exceptions, evidence, and work. Derives findings and changes nothing.',noInput,()=>window.__rippleActions?.analyzeImpact());
  r('calculate_readiness','Calculate the weighted assurance-readiness score and its component breakdown. Read-only.',noInput,()=>window.__rippleActions?.calculateReadiness());
  r('create_impact_review','Turn derived findings into individually reviewable draft proposals. Does not approve any proposal.',noInput,()=>window.__rippleActions?.createReview());
  r('explain_finding','Explain exactly which expected and observed assertions produced one finding.',idInput,({id})=>window.__rippleActions?.explainFinding(id));
  r('approve_proposal','Approve one selected draft proposal as the named human reviewer. Use only after explicit user selection.',idInput,({id})=>window.__rippleActions?.approveProposal(id));
  r('reject_proposal','Reject one selected draft proposal and preserve the human decision.',idInput,({id})=>window.__rippleActions?.rejectProposal(id));
  window.__rippleRegistered=true;return true;
}
