import { ResearchData, ScriptData, ScenesFile, SceneData } from "@/types/project";

function includesAny(text: string, words: string[]) {
  const lowerText = text.toLowerCase();
  return words.some((word) => lowerText.includes(word));
}

function estimateDuration(text: string) {
  const wordCount = text.trim().split(/\s+/).length;
  const seconds = Math.ceil((wordCount / 140) * 60);
  return Math.max(20, Math.min(seconds, 90));
}

export async function sceneStep(
  projectId: string,
  research: ResearchData,
  script: ScriptData
): Promise<ScenesFile> {
  const now = new Date().toISOString();

  const scenes: SceneData[] = [];
  let id = 1;

  scenes.push({
    id: id++,
    title: "Giriş Sahnesi",
    narration: script.intro,
    duration: estimateDuration(script.intro),
    visualDescription: `${research.topic} konusuna sinematik ve merak uyandırıcı bir giriş.`,
    imagePrompt: `Cinematic realistic historical documentary opening scene about ${research.topic}, dramatic lighting, realistic atmosphere, ultra detailed, no text`,
    animationPrompt: `Slow cinematic push-in camera movement, dramatic atmosphere, historical documentary intro about ${research.topic}`,
    cameraMovement: "Yavaş ileri kamera hareketi",
    soundEffects: ["Rüzgar", "Derin atmosfer", "Uzak yankı"],
    backgroundMusic: "Gizemli ve epik belgesel müziği",
    transition: "Siyaha yumuşak geçiş",
    voiceEmotion: "merak uyandırıcı",
    voiceSpeed: 0.95,
    subtitle: script.intro,
    mapRequired: false,
    timelineRequired: false,
    assetStatus: "pending",
    historicalNotes: [research.summary],
    references: research.sources,
  });

  for (const section of script.sections) {
    const narration = section.narration;

    scenes.push({
      id: id++,
      title: section.heading,
      narration,
      duration: estimateDuration(narration),
      visualDescription: `${section.heading} bölümünü anlatan sinematik tarih belgeseli sahnesi.`,
      imagePrompt: `Cinematic realistic historical documentary scene about ${section.heading}, connected to ${research.topic}, historically inspired setting, dramatic light, realistic people, ultra detailed, no text`,
      animationPrompt: `Slow documentary camera movement for ${section.heading}, cinematic pacing, realistic historical atmosphere`,
      cameraMovement: "Yavaş yatay kamera kaydırma",
      soundEffects: ["Ortam sesi", "Uzak kalabalık", "Hafif rüzgar"],
      backgroundMusic: "Dramatik tarih belgeseli müziği",
      transition: "Sinema tarzı kesme geçiş",
      voiceEmotion: "ciddi ve anlatıcı",
      voiceSpeed: 1,
      subtitle: narration,
      mapRequired: includesAny(narration, [
        "harita",
        "bölge",
        "şehir",
        "sefer",
        "göç",
        "yol",
        "nehir",
        "sınır",
        "imparatorluk",
      ]),
      timelineRequired: includesAny(narration, [
        "yıl",
        "tarih",
        "dönem",
        "yüzyıl",
        "önce",
        "sonra",
        "milattan",
      ]),
      assetStatus: "pending",
      historicalNotes: research.keyEvents,
      references: research.sources,
    });
  }

  scenes.push({
    id: id++,
    title: "Kapanış Sahnesi",
    narration: script.outro,
    duration: estimateDuration(script.outro),
    visualDescription: `${research.topic} hikayesini güçlü ve duygusal şekilde kapatan final sahnesi.`,
    imagePrompt: `Epic cinematic realistic historical documentary closing scene about ${research.topic}, emotional ending, dramatic sky, ultra detailed, no text`,
    animationPrompt: `Slow pull-back camera movement, emotional historical documentary ending about ${research.topic}`,
    cameraMovement: "Yavaş geri çekilme",
    soundEffects: ["Derin atmosfer", "Hafif rüzgar"],
    backgroundMusic: "Duygusal ve epik kapanış müziği",
    transition: "Siyaha kararma",
    voiceEmotion: "duygusal ve güçlü",
    voiceSpeed: 0.9,
    subtitle: script.outro,
    mapRequired: false,
    timelineRequired: false,
    assetStatus: "pending",
    historicalNotes: research.interestingFacts,
    references: research.sources,
  });

  const totalDuration = scenes.reduce((total, scene) => total + scene.duration, 0);

  return {
    projectId,
    createdAt: now,
    updatedAt: now,
    totalDuration,
    scenes,
  };
}