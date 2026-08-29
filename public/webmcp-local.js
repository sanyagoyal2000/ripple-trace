(() => {
  if (!['localhost', '127.0.0.1'].includes(location.hostname) || document.modelContext) return;
  const tools = new Map();
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: { registerTool: (tool) => tools.set(tool.name, tool) },
  });
  window.rippleWebMCP = {
    mode: 'localhost-shim',
    listTools: () => [...tools.values()].map(({ execute, ...tool }) => tool),
    callTool: (name, input = {}) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Unknown WebMCP tool: ${name}`);
      return tool.execute(input);
    },
  };
  document.documentElement.dataset.webmcpMode = 'localhost-shim';
})();
