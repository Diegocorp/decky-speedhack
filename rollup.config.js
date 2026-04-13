import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import { defineConfig } from "rollup";

export default defineConfig({
  input: "src/index.tsx",
  plugins: [
    resolve(),
    commonjs(),
    typescript({ tsconfig: "./tsconfig.json" }),
  ],
  // react and react-dom are provided as globals by Decky runtime.
  // react-icons is NOT a Decky global so we let rollup bundle it.
  external: ["react", "react-dom", "decky-frontend-lib"],
  output: {
    file: "dist/index.js",
    // No `name` — Decky loads plugins via eval(), which needs a bare
    // expression (not a var declaration) to return the plugin function.
    globals: {
      react: "SP_REACT",
      "react-dom": "SP_REACTDOM",
      "decky-frontend-lib": "DFL",
    },
    format: "iife",
    exports: "default",
  },
});
