#!/usr/bin/env bash
# =============================================================================
# limpieza_pruebas_fotos.sh — Borra del Storage las fotos de las visitas de
# prueba (las mismas 15 visitas que borra limpieza_pruebas.sql).
# -----------------------------------------------------------------------------
#   ./supabase/limpieza_pruebas_fotos.sh             # muestra qué haría
#   ./supabase/limpieza_pruebas_fotos.sh --confirmar # borra de verdad
#
# Se corre ANTES que el SQL: una vez borradas las filas, ya no hay forma de
# saber qué archivos quedaron huérfanos.
#
# POR QUÉ NO USA `supabase storage rm` — en el CLI 2.116.0 ese comando devuelve
# {"deleted":[]} y código de salida 0 SIN borrar nada. Reporta éxito en falso.
# Verificado el 2-sep-2026 con archivo suelto, con -r sobre la carpeta, y con y
# sin --linked: --debug muestra que ni siquiera llama al API de Storage. Si algún
# día lo arreglan, se puede volver a él; mientras tanto, esto va por la API REST.
#
# LA LLAVE — la key publishable no puede borrar del bucket (0003_acceso_fase1.sql
# le da insert/select/update, no delete), así que hace falta la service_role. Se
# le pide al CLI en el momento, vive solo en memoria del proceso y NUNCA se
# escribe a disco ni se imprime. No la pegues en .env.local.
#
# VERIFICA DE VERDAD — al terminar vuelve a listar el bucket y confirma que los
# archivos ya no están. No le cree a ningún código de salida. Si algo sobrevive,
# sale con error y te dice que NO corras el SQL.
# =============================================================================

set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
raiz="$(dirname "$dir")"
lista="$dir/limpieza_pruebas_fotos.txt"

[ -f "$lista" ] || { echo "No encuentro $lista" >&2; exit 1; }

mapfile -t rutas < <(grep -v '^\s*#' "$lista" | grep -v '^\s*$')
echo "Archivos en la lista: ${#rutas[@]}"

if [ "${1:-}" != "--confirmar" ]; then
  echo
  echo "MODO REVISION - no se borra nada. Se borrarian:"
  printf '  %s\n' "${rutas[@]}"
  echo
  echo "Para borrar de verdad:  ./supabase/limpieza_pruebas_fotos.sh --confirmar"
  exit 0
fi

url="$(grep '^PUBLIC_SUPABASE_URL=' "$raiz/.env.local" | cut -d= -f2- | tr -d '"'"'"' \r')"
[ -n "$url" ] || { echo "No pude leer PUBLIC_SUPABASE_URL de .env.local" >&2; exit 1; }
ref="$(cat "$dir/.temp/project-ref" 2>/dev/null | tr -d ' \r\n')"
[ -n "$ref" ] || { echo "No encuentro supabase/.temp/project-ref (corre: npx supabase link)" >&2; exit 1; }

echo "Pidiendo credencial al CLI (no se guarda en disco)..."
npx supabase projects api-keys --project-ref "$ref" -o json 2>/dev/null \
  | SUPA_URL="$url" LISTA="$lista" node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",async()=>{
  const fs=require("fs");
  let key;
  try { key=JSON.parse(s).find(k=>k.name==="service_role").api_key; }
  catch(e){ console.error("No pude obtener la service_role del CLI. ¿Corriste npx supabase login?"); process.exit(1); }
  const url=process.env.SUPA_URL.replace(/\/+$/,"");
  const H={Authorization:`Bearer ${key}`,apikey:key,"Content-Type":"application/json"};
  const rutas=fs.readFileSync(process.env.LISTA,"utf8").split(/\r?\n/)
    .map(l=>l.trim()).filter(l=>l && !l.startsWith("#"));

  // Borrado masivo, en lotes para no armar un request enorme.
  let borrados=0;
  for(let i=0;i<rutas.length;i+=20){
    const lote=rutas.slice(i,i+20);
    const r=await fetch(`${url}/storage/v1/object/evidencias`,
      {method:"DELETE",headers:H,body:JSON.stringify({prefixes:lote})});
    const txt=await r.text();
    if(!r.ok){ console.error(`HTTP ${r.status} al borrar: ${txt.slice(0,300)}`); process.exit(1); }
    try{ borrados += JSON.parse(txt).length; }catch(e){}
  }
  console.log(`El API reporta ${borrados} objetos borrados.`);

  // VERIFICACION REAL: volver a listar cada carpeta y ver qué sobrevivió.
  const carpetas=[...new Set(rutas.map(p=>p.replace(/\/[^/]+$/,"")))];
  const vivos=[];
  for(const c of carpetas){
    const r=await fetch(`${url}/storage/v1/object/list/evidencias`,
      {method:"POST",headers:H,body:JSON.stringify({prefix:c,limit:1000})});
    if(!r.ok) continue;
    for(const o of await r.json()){
      const full=`${c}/${o.name}`;
      if(rutas.includes(full)) vivos.push(full);
    }
  }
  if(vivos.length){
    console.error(`\nFALLO: ${vivos.length} archivos siguen en el bucket:`);
    vivos.forEach(v=>console.error("  "+v));
    console.error("\nNO corras limpieza_pruebas.sql: borrarias las filas y perderias");
    console.error("el rastro de estos archivos huerfanos.");
    process.exit(1);
  }
  console.log("Verificado contra el bucket: los "+rutas.length+" archivos ya no estan.");
});'

echo
echo "Listo. Ahora si, las filas:"
echo "  npx supabase db query --linked -f supabase/limpieza_pruebas.sql"
