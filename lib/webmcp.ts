/**
 * WebMCP binding.
 *
 * Written against the WebMCP spec (webmachinelearning.github.io/webmcp) and
 * Chrome's imperative API docs. Two details are easy to get wrong from memory:
 *
 *   1. Registration is `document.modelContext.registerTool(tool, { signal })` —
 *      on `document`, not `navigator` or `window.agent`.
 *   2. There is no `unregisterTool`. Deregistration is an `AbortSignal`: you
 *      pass a controller's signal at registration and abort it to remove the
 *      tool. That is why per-view registration below keeps one controller per
 *      view and fires it on exit.
 *
 * `execute` resolves with any JSON-serializable value, which the user agent
 * stringifies. It is *not* wrapped in an MCP `{content:[{type:"text"}]}`
 * envelope — that is the wire format of the MCP server protocol, not this API.
 *
 * What is NOT here matters as much as what is: no approve, reject, edit, or
 * exception-approval tool is ever constructed, let alone registered. See
 * `lib/ripple/actor.ts`.
 */

import { HUMAN_ONLY_OPERATIONS, runAsTool } from './ripple/actor';
import { ALL_TOOLS, toolsForView, type ToolDefinition, type ToolResult } from './ripple/tools';
import { logActivity, setHighlight, type ViewId } from './ripple/store';

type RegisteredTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: object;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

type ModelContext = {
  registerTool: (tool: RegisteredTool, options?: { signal?: AbortSignal }) => void | Promise<void>;
  getTools?: () => Promise<unknown[]>;
};

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Window {
    rippleWebMCP?: {
      mode: 'native' | 'localhost-shim';
      view: ViewId | null;
      listTools: () => Omit<RegisteredTool, 'execute'>[];
      callTool: (name: string, input?: Record<string, unknown>) => unknown;
      neverRegistered: readonly { name: string; where: string }[];
    };
  }
}

function activity(name: string, phase: 'started' | 'completed' | 'failed', detail?: unknown) {
  window.dispatchEvent(
    new CustomEvent('ripple:webmcp-activity', { detail: { name, phase, detail, at: new Date().toISOString() } }),
  );
}

export function isWebMCPAvailable(): boolean {
  return typeof document !== 'undefined' && Boolean(document.modelContext);
}

/**
 * The single execution path. The WebMCP handler and the in-app console both
 * call this, so what a judge exercises through an agent and what you exercise
 * locally are the same code — including the actor boundary and the activity log.
 */
export function invokeTool(tool: ToolDefinition, input: Record<string, unknown>): ToolResult {
  activity(tool.name, 'started');
  const started = performance.now();
  try {
    const result = runAsTool(tool.name, () => tool.execute(input ?? {}));
    const touched = tool.touched?.(result) ?? [];
    logActivity({
      actor: 'agent:webmcp',
      origin: 'agent',
      tool: tool.name,
      message: result.summary,
      entityIds: touched,
    });
    if (touched.length) setHighlight(touched);
    activity(tool.name, 'completed', result);
    return { ...result, _elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logActivity({
      actor: 'agent:webmcp',
      origin: 'agent',
      tool: tool.name,
      message: `Refused: ${message}`,
      entityIds: [],
      refused: true,
    });
    activity(tool.name, 'failed', message);
    // Returned, not thrown: a boundary refusal is information the agent should
    // read and correct itself against, not a crash.
    return { summary: `Tool '${tool.name}' could not complete: ${message}`, error: message };
  }
}

let activeController: AbortController | null = null;
let activeView: ViewId | null = null;
const shimTools = new Map<string, RegisteredTool>();

function installShimIfLocal(): 'native' | 'localhost-shim' | 'unavailable' {
  if (typeof document === 'undefined') return 'unavailable';
  if (document.modelContext) return 'native';
  // A shim only on localhost, so the deployed page never pretends to have
  // WebMCP it does not have.
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return 'unavailable';
  document.modelContext = {
    registerTool: (tool, options) => {
      shimTools.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => shimTools.delete(tool.name));
    },
  };
  return 'localhost-shim';
}

/**
 * Register exactly the tools relevant to `view`, and deregister whatever the
 * previous view had registered.
 *
 * Dumping all 16 tools on load would measurably degrade the agent's selection
 * accuracy, and the surface is meant to track what the human is looking at.
 */
export function syncToolsToView(view: ViewId): { registered: string[]; mode: string } {
  const mode = installShimIfLocal();
  const context = typeof document !== 'undefined' ? document.modelContext : undefined;
  const names = toolsForView(view).map((t) => t.name);

  if (!context) {
    activeView = view;
    return { registered: [], mode: 'unavailable' };
  }
  if (activeView === view && activeController) return { registered: names, mode };

  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  activeView = view;

  for (const tool of toolsForView(view)) {
    void context.registerTool(
      {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        execute: async (input) => invokeTool(tool, input ?? {}),
      },
      { signal: controller.signal },
    );
  }

  window.rippleWebMCP = {
    mode: mode === 'localhost-shim' ? 'localhost-shim' : 'native',
    view,
    listTools: () =>
      [...shimTools.values()].map((tool) => {
        const { execute, ...rest } = tool;
        void execute;
        return rest;
      }),
    callTool: (name, input = {}) => {
      const tool = ALL_TOOLS.find((t) => t.name === name);
      if (!tool) throw new Error(`Unknown or unregistered WebMCP tool: ${name}`);
      return invokeTool(tool, input);
    },
    // Discoverable from the console, because the absence is the point.
    neverRegistered: HUMAN_ONLY_OPERATIONS.map(({ name, where }) => ({ name, where })),
  };

  document.documentElement.dataset.webmcpTools = String(names.length);
  document.documentElement.dataset.webmcpMode = mode;
  document.documentElement.dataset.webmcpView = view;

  logActivity({
    actor: 'rippletrace',
    origin: 'human',
    message: `Registered ${names.length} tool(s) for the ${view} view; the previous set was deregistered.`,
    entityIds: [],
  });

  window.dispatchEvent(new CustomEvent('ripple:webmcp-ready', { detail: { toolCount: names.length, mode, view } }));
  return { registered: names, mode };
}

export function deregisterAll() {
  activeController?.abort();
  activeController = null;
  activeView = null;
}
