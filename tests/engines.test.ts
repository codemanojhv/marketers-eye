import { describe, expect, it } from "vitest";
import { textModelIds } from "../src/engines.js";

describe("provider model discovery", () => {
  it("keeps Gemini models that support text generation and strips the resource prefix", () => {
    expect(textModelIds("gemini", { models: [
      { name: "models/gemini-flash-002", baseModelId: "gemini-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-image", supportedGenerationMethods: ["predict"] },
    ] })).toEqual(["gemini-flash"]);
  });

  it("omits non-text OpenAI models, removes duplicates, and sorts the dropdown", () => {
    expect(textModelIds("openai", { data: [
      { id: "gpt-z" }, { id: "text-embedding-3-large" }, { id: "gpt-a" }, { id: "gpt-a" },
    ] })).toEqual(["gpt-a", "gpt-z"]);
  });

  it("uses DeepSeek's listed model ids", () => {
    expect(textModelIds("deepseek", { data: [
      { id: "deepseek-flash", output_modalities: ["text"] },
      { id: "deepseek-vision", output_modalities: ["image"] },
      { id: "deepseek-v4-pro" },
    ] })).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
  });
});
