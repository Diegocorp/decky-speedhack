"""
main.py — Decky plugin backend for SpeedHack
"""

import json
import os

import decky_plugin  # type: ignore

PLUGIN_DIR    = decky_plugin.DECKY_PLUGIN_DIR
LIB_INSTALL   = os.path.join(PLUGIN_DIR, "bin", "libspeedhack.so")
FACTOR_FILE   = "/tmp/speedhack_factor"
SETTINGS_FILE = os.path.join(decky_plugin.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")

DEFAULT_SETTINGS = {"enabled": False, "speed": 1.0}


def _load_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return dict(DEFAULT_SETTINGS)


def _save_settings(s: dict) -> None:
    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    with open(SETTINGS_FILE, "w") as f:
        json.dump(s, f, indent=2)


def _write_factor(factor: float) -> None:
    with open(FACTOR_FILE, "w") as f:
        f.write(str(factor))


class Plugin:

    async def _main(self):
        s = _load_settings()
        _write_factor(s["speed"] if s["enabled"] else 1.0)
        decky_plugin.logger.info("SpeedHack loaded — enabled=%s speed=%s", s["enabled"], s["speed"])

    async def _unload(self):
        _write_factor(1.0)

    # ------------------------------------------------------------------ #
    #  Frontend-callable                                                   #
    # ------------------------------------------------------------------ #

    async def get_state(self) -> dict:
        return _load_settings()

    async def get_lib_path(self) -> dict:
        """Return the absolute path to libspeedhack.so."""
        return {"path": LIB_INSTALL}

    async def get_running_game(self) -> dict:
        """
        Detect the currently running Steam game by scanning /proc for any
        process that has SteamAppId set in its environment.
        Returns {"app_id": int, "pid": int} or {"app_id": 0}.
        """
        try:
            for pid in os.listdir("/proc"):
                if not pid.isdigit():
                    continue
                try:
                    with open(f"/proc/{pid}/environ", "rb") as f:
                        raw = f.read().decode("utf-8", errors="replace")
                    env = dict(
                        pair.split("=", 1)
                        for pair in raw.split("\x00")
                        if "=" in pair
                    )
                    app_id_str = env.get("SteamAppId", "0")
                    if app_id_str and app_id_str != "0":
                        return {"app_id": int(app_id_str), "pid": int(pid)}
                except (PermissionError, FileNotFoundError, ValueError):
                    continue
        except Exception as e:
            decky_plugin.logger.error("get_running_game error: %s", e)
        return {"app_id": 0}

    async def set_speed(self, enabled: bool, speed: float) -> dict:
        speed = max(0.1, min(speed, 32.0))
        s = _load_settings()
        s["enabled"] = enabled
        s["speed"] = speed
        _save_settings(s)
        factor = speed if enabled else 1.0
        _write_factor(factor)
        msg = f"Speed set to {factor}x" if enabled else "Disabled (1.0x)"
        decky_plugin.logger.info(msg)
        return {"message": msg}
