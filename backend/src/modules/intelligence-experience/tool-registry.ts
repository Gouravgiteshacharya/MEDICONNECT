import type {
  AssistantTool,
  ToolExecutionResult,
  TrustedAssistantContext,
} from "./contracts.js";

export class ToolRegistry {
  readonly #tools = new Map<string, AssistantTool>();

  register(tool: AssistantTool): void {
    if (!tool.name.trim()) throw new Error("Tool name is required");
    if (this.#tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.#tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  async execute(
    name: string,
    input: unknown,
    context: TrustedAssistantContext,
  ): Promise<ToolExecutionResult<unknown>> {
    const tool = this.#tools.get(name);
    if (!tool) {
      if (name === "medicine_discovery") {
        return { status: "error", code: "unavailable", message: "Medicine discovery is currently unavailable." };
      }
      return { status: "error", code: "not_found", message: `Assistant tool is not registered: ${name}` };
    }
    
    try {
      return await tool.execute(input, context);
    } catch {
      return {
        status: "error",
        code: "execution_failed",
        message: "The assistant tool could not complete the request.",
      };
    }
  }
}
