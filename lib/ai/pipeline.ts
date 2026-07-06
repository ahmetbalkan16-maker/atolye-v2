import { researchStep } from "./steps/researchStep";
import { scriptStep } from "./steps/scriptStep";
import { sceneStep } from "./steps/sceneStep";

export async function pipeline(topic: string) {
  try {
    const research = await researchStep(topic);
    const script = await scriptStep(research);
    const scenes = await sceneStep(script);

    return {
      success: true,
      topic,
      research,
      script,
      scenes,
    };

  } catch (error) {
    return {
      success: false,
      error: "Pipeline failed",
    };
  }
}