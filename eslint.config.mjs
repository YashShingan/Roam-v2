import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// Next 16 ships eslint-config-next as native flat-config arrays — no
// FlatCompat translation layer (whose legacy validator crashes on it).
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // the remaining uses are intentional one-shot syncs with external systems
      // (URL boot hydration, navigator.onLine, dialog-close cleanup)
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  { ignores: ["node_modules/**", ".next/**", "data/**", "scripts/**", "public/**"] },
];

export default eslintConfig;
