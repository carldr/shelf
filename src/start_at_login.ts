import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

/**
 * Registers or removes Shelf's login item to match the setting.
 * Dev builds leave the login item alone, so that `pnpm tauri dev` does not make the Mac
 * start the debug binary at login.
 */
export async function apply_start_at_login_setting(start_at_login: boolean): Promise<void> {
  if (import.meta.env.DEV) {
    return;
  }
  try {
    const start_at_login_is_registered = await isEnabled();
    if (start_at_login && !start_at_login_is_registered) {
      await enable();
    } else if (!start_at_login && start_at_login_is_registered) {
      await disable();
    }
  } catch (start_at_login_error) {
    console.warn("Shelf could not change its login item", start_at_login_error);
  }
}
