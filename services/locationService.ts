import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

const getBrowserLocation = (): Promise<{ latitude: number; longitude: number }> =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this device.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => reject(new Error(error.message)),
      {
        enableHighAccuracy: true,
        timeout: 10000,
      },
    );
  });

export const requestCurrentLocation = async (): Promise<{ latitude: number; longitude: number }> => {
  if (Capacitor.isNativePlatform()) {
    const permission = await Geolocation.requestPermissions();
    if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') {
      throw new Error('Location permission was not granted.');
    }

    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  }

  return getBrowserLocation();
};
