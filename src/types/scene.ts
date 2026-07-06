export interface SceneItem {
  id: number;
  title: string;
  description: string;
  visualPrompt?: string;
  duration?: number;
}

export interface SceneData {
  scenes: SceneItem[];
  createdAt: string;
}