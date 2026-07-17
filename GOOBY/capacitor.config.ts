import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.gooby.pet",
  appName: "Gooby’s Cozy Burrow",
  webDir: "dist",
  ios: {
    contentInset: "always",
    preferredContentMode: "mobile",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#f9dcb5",
    },
    StatusBar: { style: "LIGHT" },
  },
};

export default config;
