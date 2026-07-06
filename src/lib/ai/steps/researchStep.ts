export async function researchStep(topic: string) {
  return {
    topic,
    summary: `${topic} hakkında otomatik araştırma`,
    timeline: [],
    characters: [],
    keyEvents: [],
    interestingFacts: [],
  };
}