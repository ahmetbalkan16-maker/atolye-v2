/** Frozen before CF49 remediation. Independent wording and negative scope/trust cases. */
export const cf49Held = [
  {id:"H01",body:"Sessiz bir notebook satın almaya karar verdim",kind:"decision",trust:"direct",expected:true},
  {id:"H02",body:"Yeni bir PC toplamaya karar verdim",kind:"decision",trust:"correction",expected:true},
  {id:"H03",body:"Bilgisayar almaya karar vermedim",kind:"decision",trust:"direct",expected:false},
  {id:"H04",body:"Bilgisayar almaya karar verdim?",kind:"decision",trust:"direct",expected:false},
  {id:"H05",body:"Komşum laptop almaya karar verdi",kind:"decision",trust:"direct",expected:false},
  {id:"H06",body:"Laptop ekranını kalibre etmeye karar verdim",kind:"decision",trust:"direct",expected:false},
  {id:"H07",body:"Bilgisayarımda iki disk var",kind:"environment-note",trust:"direct",expected:false},
  {id:"H08",body:"İnce dizüstü modelleri tercih ederim",kind:"user-preference",trust:"direct",expected:false},
  {id:"H09",body:"Bir bisiklet almaya karar verdim",kind:"decision",trust:"direct",expected:false},
  {id:"H10",body:"Yeni laptop almaya karar verdim",kind:"decision",trust:"imported",expected:false},
  {id:"H11",body:"Yeni laptop almaya karar verdim",kind:"decision",trust:"inferred",expected:false},
  {id:"H12",body:"Bir gün belki bilgisayar alırım",kind:"decision",trust:"direct",expected:false},
] as const;
