import { ScriptDocument } from "./schema";

export function validateScript(data: unknown): ScriptDocument {
  const script = data as ScriptDocument;

  if (!script.title)
    throw new Error("Title missing");

  if (!script.summary)
    throw new Error("Summary missing");

  if (!Array.isArray(script.sections))
    throw new Error("Sections missing");

  return script;
}