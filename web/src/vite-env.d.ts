/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XRAY_MODE?: string;
  readonly VITE_XRAY_BASE_URL?: string;
  readonly VITE_OAT_MODE?: string;
  readonly VITE_OAT_BASE_URL?: string;
  readonly VITE_OAT_PATHS?: string;
}
