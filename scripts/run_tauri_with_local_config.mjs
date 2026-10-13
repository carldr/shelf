// Runs the Tauri CLI. For `dev` and `build`, it also passes src-tauri/tauri.local.conf.json
// when that file exists, so that a local bundle identifier (and later a signing identity)
// stays out of the repository. Tauri merges the local file over tauri.conf.json.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const TAURI_LOCAL_CONFIG_PATH = "src-tauri/tauri.local.conf.json";
const SUBCOMMANDS_THAT_READ_CONFIG = new Set(["dev", "build"]);

const tauri_arguments = process.argv.slice(2);
if (SUBCOMMANDS_THAT_READ_CONFIG.has(tauri_arguments[0]) && existsSync(TAURI_LOCAL_CONFIG_PATH)) {
  tauri_arguments.push("--config", TAURI_LOCAL_CONFIG_PATH);
}

// pnpm puts node_modules/.bin on PATH for package scripts, so "tauri" is the project's CLI.
const tauri_result = spawnSync("tauri", tauri_arguments, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(tauri_result.status ?? 1);
