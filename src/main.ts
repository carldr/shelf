import { invoke } from "@tauri-apps/api/core";

document.addEventListener("keydown", (keyboard_event) => {
  if (keyboard_event.key === "Escape") {
    void invoke("hide_shelf_window_command");
  }
});

const app_root = document.getElementById("app_root")!;
app_root.textContent = "Shelf";
