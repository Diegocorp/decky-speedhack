import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import { defineConfig } from "rollup";

export default defineConfig({
  input: "src/index.tsx",
  plugins: [
    commonjs(),
    resolve(),
    typescript(),
  ],
  external: ["react", "react-dom", "decky-frontend-lib"],
  output: {
    file: "dist/index.js",
    globals: {
      react: "SP_REACT",
      "react-dom": "SP_REACTDOM",
      "decky-frontend-lib": "DFL",
    },
    format: "iife",
    exports: "default",
  },
});
