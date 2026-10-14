import {NextResponse,type NextRequest} from 'next/server';
import { ayasSafeModeHold } from "@/lib/ayas/safety/AyasSafeModeReader";
import {CharacterDesignLibrary} from '@/lib/character/volume/CharacterDesignLibrary';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Existing access middleware authenticates all /api paths and rejects cross-origin mutations.
export async function GET(request:NextRequest) {
  try {
    const library=new CharacterDesignLibrary(),id=request.nextUrl.searchParams.get('preview');
    if(id)return new NextResponse(new Uint8Array(library.preview(id)),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    return NextResponse.json({success:true,designs:library.list(),currentRevision:library.geometryFingerprint},{headers:{'Cache-Control':'private, no-store'}});
  } catch{return NextResponse.json({success:false,error:'Karakter kitaplığı okunamadı. Kayıtlar değiştirilmedi.'},{status:409});}
}
export async function POST(request:NextRequest) {
  // Stage 15R: nothing but a read starts while AYAS is in SAFE_READ_ONLY.
  const safeMode = ayasSafeModeHold();
  if (safeMode) return NextResponse.json({ success: false, error: safeMode }, { status: 423 });
  try {
    if(Number(request.headers.get('content-length')??0)>4096)return NextResponse.json({success:false,error:'İstek çok büyük.'},{status:413});
    const raw=await request.text();if(raw.length>4096)return NextResponse.json({success:false,error:'İstek çok büyük.'},{status:413});
    const body=JSON.parse(raw) as Record<string,unknown>;
    if(!body||Object.keys(body).length!==3||body.action!=='approve'||typeof body.id!=='string'||typeof body.digest!=='string')return NextResponse.json({success:false,error:'Geçersiz onay isteği.'},{status:400});
    const design=new CharacterDesignLibrary().approve(body.id,body.digest);
    return NextResponse.json({success:true,design},{headers:{'Cache-Control':'private, no-store'}});
  } catch{return NextResponse.json({success:false,error:'Onay kaydedilemedi. Tasarım değişmiş olabilir; listeyi yenileyin.'},{status:409});}
}
