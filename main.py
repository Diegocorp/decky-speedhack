"""
main.py — Decky plugin backend for SpeedHack
"""

import asyncio
import json
import os

import decky_plugin  # type: ignore

PLUGIN_DIR    = decky_plugin.DECKY_PLUGIN_DIR
LIB_INSTALL   = os.path.join(PLUGIN_DIR, "bin", "libspeedhack.so")
FACTOR_FILE   = "/tmp/speedhack_factor"
DEBUG_TRIGGER = "/tmp/speedhack_debug"
DEBUG_LOG     = "/tmp/speedhack_debug.log"
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


def _reset_speed() -> None:
    """Reset factor file and saved settings to 1x."""
    _write_factor(1.0)
    s = _load_settings()
    s["enabled"] = False
    s["speed"] = 1.0
    _save_settings(s)


def _get_running_app_id() -> int:
    """Scan /proc for a process with SteamAppId set. Returns 0 if none."""
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
                val = env.get("SteamAppId", "0")
                if val and val != "0":
                    return int(val)
            except (PermissionError, FileNotFoundError, ValueError):
                continue
    except Exception:
        pass
    return 0


class Plugin:

    async def _main(self):
        s = _load_settings()
        _write_factor(s["speed"] if s["enabled"] else 1.0)
        decky_plugin.logger.info(
            "SpeedHack loaded — enabled=%s speed=%s", s["enabled"], s["speed"]
        )
        # Background task: reset speed when the running game exits
        asyncio.create_task(self._monitor_game())

    async def _unload(self):
        _write_factor(1.0)

    async def _monitor_game(self):
        """Poll every 2 s; reset speed to 1x when a running game exits."""
        last_app_id = _get_running_app_id()
        while True:
            await asyncio.sleep(2)
            try:
                current_app_id = _get_running_app_id()
                if last_app_id != 0 and current_app_id == 0:
                    decky_plugin.logger.info(
                        "Game %s closed — resetting speed to 1x", last_app_id
                    )
                    _reset_speed()
                last_app_id = current_app_id
            except Exception as e:
                decky_plugin.logger.error("_monitor_game error: %s", e)

    # ------------------------------------------------------------------ #
    #  Frontend-callable                                                   #
    # ------------------------------------------------------------------ #

    async def get_state(self) -> dict:
        return _load_settings()

    async def get_lib_path(self) -> dict:
        return {"path": LIB_INSTALL}

    async def set_speed(self, enabled: bool, speed: float) -> dict:
        speed = max(0.1, min(speed, 32.0))
        s = _load_settings()
        s["enabled"] = enabled
        s["speed"] = speed
        _save_settings(s)
        factor = speed if enabled else 1.0
        _write_factor(factor)
        msg = f"Active at {factor}x" if enabled else "Normal speed"
        decky_plugin.logger.info("set_speed: %s", msg)
        return {"message": msg}

    async def get_running_game(self) -> dict:
        app_id = _get_running_app_id()
        return {"app_id": app_id}

    # ------------------------------------------------------------------ #
    #  Debug logging                                                        #
    # ------------------------------------------------------------------ #

    async def enable_debug(self) -> dict:
        """Create the trigger file so the C library starts logging."""
        # Clear old log first
        if os.path.exists(DEBUG_LOG):
            os.remove(DEBUG_LOG)
        open(DEBUG_TRIGGER, "w").close()
        decky_plugin.logger.info("SpeedHack debug logging ENABLED")
        return {"enabled": True}

    async def disable_debug(self) -> dict:
        """Remove the trigger file to stop logging."""
        if os.path.exists(DEBUG_TRIGGER):
            os.remove(DEBUG_TRIGGER)
        decky_plugin.logger.info("SpeedHack debug logging DISABLED")
        return {"enabled": False}

    async def get_debug_state(self) -> dict:
        return {"enabled": os.path.exists(DEBUG_TRIGGER)}

    async def get_debug_log(self) -> dict:
        """Return the contents of the debug log (last 4000 chars)."""
        try:
            with open(DEBUG_LOG, "r") as f:
                content = f.read()
            # Return last 4000 chars so the UI doesn't overflow
            return {"log": content[-4000:] if len(content) > 4000 else content}
        except FileNotFoundError:
            return {"log": "No log yet.\nEnable debug, launch/play the game, then refresh."}
        except Exception as e:
            return {"log": f"Error reading log: {e}"}

    async def save_debug_log_to_desktop(self) -> dict:
        """Copy the debug log to ~/Desktop/speedhack_debug.txt."""
        desktop = os.path.expanduser("~/Desktop")
        dest = os.path.join(desktop, "speedhack_debug.txt")
        try:
            with open(DEBUG_LOG, "r") as f:
                content = f.read()
            os.makedirs(desktop, exist_ok=True)
            with open(dest, "w") as f:
                f.write(content)
            decky_plugin.logger.info("Debug log saved to %s", dest)
            return {"ok": True, "path": dest}
        except FileNotFoundError:
            return {"ok": False, "error": "No log yet. Enable debug and play the game first."}
        except Exception as e:
            return {"ok": False, "error": str(e)}
