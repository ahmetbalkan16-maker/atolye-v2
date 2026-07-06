export interface ScriptSection {
  title: string;
  narration: string;
  duration: number;
}

export interface ScriptDocument {
  title: string;
  summary: string;
  sections: ScriptSection[];
}