import rings from './data/natural-earth-land-110m.json';
/** Fixed regional crop of Natural Earth public-domain 1:110m land. Coordinates
 * and point labels share this projection; never infer historical borders. */
export function projectEditorialLocation(lon:number,lat:number):readonly [number,number] {
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon< -25||lon>165||lat< -30||lat>80)throw Error('EDITORIAL_MAP_POINT');
 return [260+(lon+25)/190*1380,200+(80-lat)/110*570];
}
let cached:string|undefined;
export function naturalEarthEditorialLand():string {
 if(cached)return cached;
 if(rings.length>200||rings.reduce((n,r)=>n+r.length,0)>20000)throw Error('EDITORIAL_MAP_BOUNDS');
 cached=rings.map(r=>{if(r.length<3)throw Error('EDITORIAL_MAP_RING');return r.map((p,i)=>{if(p.length!==2)throw Error('EDITORIAL_MAP_PAIR');const [x,y]=projectEditorialLocation(p[0]!,p[1]!);return `${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`;}).join('')+'Z';}).join('');
 return cached;
}
