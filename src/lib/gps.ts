// Lectura de GPS del dispositivo. No bloquea el flujo de captura: si no hay
// permiso o señal, se resuelve en null y la visita se guarda igual (la ubicación
// es un dato más, nunca un requisito que impida capturar sin señal).

export interface Ubicacion {
  lat: number;
  lng: number;
  precision: number; // metros
}

export function obtenerUbicacion(): Promise<Ubicacion | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          precision: Math.round(p.coords.accuracy),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}
