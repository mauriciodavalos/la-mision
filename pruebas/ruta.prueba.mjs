// De la URL al slug de la empresa.
//
// Es la prueba más corta del repo y la que cuida la regla más dura: los datos de
// un cliente nunca se muestran bajo el nombre de otro. Si esto se equivoca, el
// tablero abre la empresa equivocada y nadie se entera, porque la pantalla se ve
// perfectamente bien.

export async function correr({ slugDeLaUrl }, check) {
  check(slugDeLaUrl("/bikes-shot/panel") === "bikes-shot", "la ruta normal da el slug");
  check(slugDeLaUrl("/davalos-osio/panel") === "davalos-osio", "un slug con guion se lee completo");
  check(slugDeLaUrl("/bikes-shot/panel/") === "bikes-shot", "la diagonal final no estorba");
  check(slugDeLaUrl("/BIKES-SHOT/panel") === "bikes-shot", "se normaliza a minúsculas");

  // Rutas reales de la app: ninguna debe interpretarse como una empresa.
  check(slugDeLaUrl("/admin/reportes") === null, "el panel de todos los clientes no es un slug");
  check(slugDeLaUrl("/captura") === null, "la pantalla de captura no es un slug");
  check(slugDeLaUrl("/") === null, "la raíz no es una empresa");
  check(slugDeLaUrl("/panel") === null, "sin empresa no hay empresa: no se adivina una");

  // Un segmento de más cambiaría de qué empresa se leen los datos.
  check(
    slugDeLaUrl("/algo/bikes-shot/panel") === null,
    "una ruta más profunda NO se interpreta: sin esto, /x/otra-empresa/panel colaría otra empresa"
  );

  // Basura que no tiene por qué llegar a la consulta.
  check(slugDeLaUrl("/../panel") === null, "un salto de directorio no es un slug");
  check(slugDeLaUrl("/bikes shot/panel") === null, "un espacio no es parte del alfabeto de slugify()");
  check(slugDeLaUrl("/bikes_shot/panel") === null, "el guion bajo tampoco: slugify() solo produce guiones");
  check(slugDeLaUrl("/-bikes/panel") === null, "un guion al inicio no lo produce slugify()");
  check(slugDeLaUrl("/bikes--shot/panel") === null, "dos guiones seguidos tampoco");
  check(slugDeLaUrl("/bikes-shot/PANEL") === null, "la palabra panel se exige tal cual");
}
