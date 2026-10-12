"use client";
import {useEffect,useState} from 'react';
import Image from 'next/image';
import {StudioCard,StudioLayout} from '@/components/studio';
import type {CharacterDesignCard} from '@/lib/character/volume/CharacterDesignLibrary';
const names:Record<string,string>={JANISSARY_EARLY:'Erken dönem yeniçeri',JANISSARY_OFFICER_18:'18. yüzyıl yeniçeri ağası',JANISSARY_GUARDHOUSE_18:'18. yüzyıl karakol yeniçerisi',OTTOMAN_MAIL_PLATE:'Osmanlı zincir ve plaka zırhı',OTTOMAN_FEZ_COURT:'Fesli Osmanlı hükümdarı',OTTOMAN_15_PORTRAIT:'15. yüzyıl Osmanlı hükümdarı',OTTOMAN_16_TEXTILE:'16. yüzyıl Osmanlı kaftanı',BYZANTINE_PALAIOLOGAN:'Geç Bizans hükümdarı',ROMAN_EARLY_IMPERIAL:'Erken Roma imparatoru',EGYPTIAN_DYNASTY_18:'18. hanedan Mısır hükümdarı'};
const cultures:Record<string,string>={UNKNOWN:'Genel',OTTOMAN:'Osmanlı',BYZANTINE:'Bizans',ROMAN:'Roma',EGYPTIAN:'Antik Mısır',WESTERN:'Batı Avrupa',STEPPE:'Bozkır'};
const year=(v:number|null)=>v===null?'Dönem kaynağı gerekli':v<0?`MÖ ${-v}`:`MS ${v}`;
export default function CharacterLibraryPage() {
  const [designs,setDesigns]=useState<CharacterDesignCard[]>([]),[revision,setRevision]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState('');
  async function load(){const res=await fetch('/api/studio/characters',{cache:'no-store'}),data=await res.json();if(!res.ok||!data.success)throw new Error(data.error??'Kitaplık yüklenemedi.');setDesigns(data.designs);setRevision(data.currentRevision);}
  useEffect(()=>{let mounted=true;void fetch('/api/studio/characters',{cache:'no-store'}).then(async res=>{const data=await res.json();if(!res.ok||!data.success)throw new Error(data.error??'Kitaplık yüklenemedi.');if(mounted){setDesigns(data.designs);setRevision(data.currentRevision);}}).catch(e=>{if(mounted)setError(e.message);});return()=>{mounted=false;};},[]);
  async function approve(d:CharacterDesignCard){setBusy(d.id);setError('');try{const res=await fetch('/api/studio/characters',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve',id:d.id,digest:d.digest})}),data=await res.json();if(!res.ok||!data.success)throw new Error(data.error??'Onay kaydedilemedi.');await load();}catch(e){setError(e instanceof Error?e.message:'İşlem tamamlanamadı.');}finally{setBusy('');}}
  return <StudioLayout title="Karakter Kitaplığı" subtitle="Beğendiğiniz kıyafet ve karakter tasarımlarını sonraki videolarda kullanın.">
    <p className="mb-5 text-zinc-300">Mevcut tasarımlar yeniden kullanılır; yalnız eksik şablon hazırlanır. Hareketli kareler sahneye göre çizilir. Onayınız tasarımın görünümü içindir; tarihî doğruluk belgesi değildir.</p>
    {error&&<p role="alert" className="mb-4 text-red-300">{error}</p>}
    {designs.length===0&&!error&&<p>İlk karakter sahnesi üretildiğinde tasarımlar burada görünür.</p>}
    <div className="grid gap-5 md:grid-cols-2">{designs.map(d=><StudioCard key={d.id} title={names[d.spec.family]??`${cultures[d.spec.culture]} karakter tasarımı`}>
      {d.previewSha256&&<Image unoptimized src={`/api/studio/characters?preview=${d.id}`} alt="Üretim motorundan karakter ve kıyafet önizlemesi" width={640} height={360} className="mb-3 w-full rounded-lg"/>}
      <p>{cultures[d.spec.culture]} · {year(d.spec.period[0])}{d.spec.period[1]!==d.spec.period[0]?` – ${year(d.spec.period[1])}`:''}</p>
      <p className="my-2">{d.status==='OWNER_APPROVED'?'Kaydedildi ve tekrar kullanılabilir':'Görünüm onayınızı bekliyor'}</p>
      {d.spec.geometryFingerprint!==revision?<p className="text-amber-200">Önceki tasarım sürümü korunuyor. Yeni sürümü ayrıca inceleyin.</p>:d.status!=='OWNER_APPROVED'&&<button onClick={()=>void approve(d)} disabled={!!busy||!d.previewSha256} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{busy===d.id?'Kaydediliyor…':'Beğendim, sakla ve kullan'}</button>}
      <div className="mt-3 flex flex-wrap gap-3">{d.spec.sources.map((url,i)=><a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-300 underline">Tarihî kaynak {i+1}</a>)}</div>
    </StudioCard>)}</div>
  </StudioLayout>;
}
