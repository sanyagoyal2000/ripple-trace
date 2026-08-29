export type ClauseFlowActions = {
  getRequirement: (id: string) => unknown;
  getTraceabilityGraph: () => unknown;
  analyzeChangeImpact: (id: string) => unknown;
  createImpactReview: () => unknown;
  approveProposal: (id: string) => unknown;
  rejectProposal: (id: string) => unknown;
  generateTraceabilityReport: () => unknown;
};

declare global {
  interface Window { __clauseflowActions?: ClauseFlowActions; __clauseflowRegistered?: boolean }
  interface Document { modelContext?: { registerTool: (tool: { name: string; description: string; inputSchema: object; execute: (input: Record<string, string>) => unknown }) => void } }
}

const schemas = {
  id: { type: 'object', properties: { id: { type: 'string', description: 'Stable ClauseFlow record identifier' } }, required: ['id'] },
  none: { type: 'object', properties: {} },
};

export function registerClauseFlowTools(actions: ClauseFlowActions) {
  window.__clauseflowActions = actions;
  if (!document.modelContext || window.__clauseflowRegistered) return false;
  const register = (name: string, description: string, inputSchema: object, execute: (input: Record<string, string>) => unknown) => document.modelContext?.registerTool({ name, description, inputSchema, execute });

  register('get_requirement', 'Read an approved policy requirement and its current execution status. This tool does not modify records.', schemas.id, ({ id }) => window.__clauseflowActions?.getRequirement(id));
  register('get_traceability_graph', 'Read the current requirement-to-control-to-work traceability graph, including gaps and provenance.', schemas.none, () => window.__clauseflowActions?.getTraceabilityGraph());
  register('analyze_change_impact', 'Analyze how a revised requirement affects controls, work, tests, evidence, and exceptions. Analysis never modifies approved records.', schemas.id, ({ id }) => window.__clauseflowActions?.analyzeChangeImpact(id));
  register('create_impact_review', 'Create a human-reviewable set of proposals for the analyzed policy change. Proposals remain drafts until separately approved.', schemas.none, () => window.__clauseflowActions?.createImpactReview());
  register('approve_proposal', 'Approve one pending change proposal after human review. Use only when the user has explicitly selected the proposal.', schemas.id, ({ id }) => window.__clauseflowActions?.approveProposal(id));
  register('reject_proposal', 'Reject one pending change proposal and preserve the decision in history.', schemas.id, ({ id }) => window.__clauseflowActions?.rejectProposal(id));
  register('generate_traceability_report', 'Generate a structured readiness report from the current approved state, unresolved gaps, evidence, and decision history.', schemas.none, () => window.__clauseflowActions?.generateTraceabilityReport());
  window.__clauseflowRegistered = true;
  return true;
}
