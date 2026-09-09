import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Reverse-DNS package ID for Google Play publishing.
  appId: 'com.geointellisense.app',
  appName: 'GeoIntelliSense',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    // The WebView origin is https://localhost, so a plain-HTTP request to a
    // LAN server (http://192.168.x.x:8080) counts as mixed content and is
    // blocked unless this is set. It only has an effect in debug builds:
    // release builds forbid cleartext at the OS level via
    // android/app/src/main/res/xml/network_security_config.xml.
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
    },
  },
};

export default config;
