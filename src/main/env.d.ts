// Values from the .env file in the project folder. electron-vite hands the main
// process the ones starting with MAIN_VITE_. Never commit .env.
interface ImportMetaEnv {
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
