import { defineConfig } from "vite";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  base: "/weigh-mix-hand-sim/",
  plugins: [tailwind()],
  build: { target: "es2022" },
});
