"""
main.py — Decky plugin backend for SpeedHack

Responsibilities:
  - Build and install the libspeedhack.so LD_PRELOAD library
  - Write the current speed multiplier to /tmp/speedhack_factor so the
    library can pick it up without a restart
  - Persist enabled/speed state across sessions
  - Return the Steam launch option string the user should paste in
"""

import asyncio
import json
import os
import subprocess

import decky_plugin  # type: ignore  (provided by Decky Loader runtime)

# Where the shared library lives once installed
PLUGIN_DIR   = decky_plugin.DECKY_PLUGIN_DIR          # e.g. ~/homebrew/plugins/SpeedHack
LIB_SRC_DIR  = os.path.join(PLUGIN_DIR, "speedhack")
LIB_INSTALL  = os.path.join(PLUGIN_DIR, "bin", "libspeedhack.so")

# Runtime communication file — the C library reads this for live updates
FACTOR_FILE  = "/tmp/speedhack_factor"

# Persistent settings
SETTINGS_FILE = os.path.join(decky_plugin.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")

DEFAULT_SETTINGS = {
    "enabled": False,
    "speed": 1.0,
}


def _load_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return dict(DEFAULT_SETTINGS)


def _save_settings(settings: dict) -> None:
    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=2)


def _write_factor(factor: float) -> None:
    """Write the speed factor to the file the C library polls."""
    with open(FACTOR_FILE, "w") as f:
        f.write(str(factor))


class Plugin:

    # ------------------------------------------------------------------ #
    #  Lifecycle                                                           #
    # ------------------------------------------------------------------ #

    async def _main(self):
        """Called once when the plugin loads."""
        settings = _load_settings()
        if settings["enabled"]:
            _write_factor(settings["speed"])
        else:
            _write_factor(1.0)
        decky_plugin.logger.info(
            "SpeedHack loaded — enabled=%s speed=%s",
            settings["enabled"],
            settings["speed"],
        )

    async def _unload(self):
        """Called when the plugin is unloaded."""
        _write_factor(1.0)
        decky_plugin.logger.info("SpeedHack unloaded, speed reset to 1.0")

    # ------------------------------------------------------------------ #
    #  Frontend-callable methods                                           #
    # ------------------------------------------------------------------ #

    async def get_state(self) -> dict:
        """Return current enabled flag and speed multiplier."""
        return _load_settings()

    async def set_speed(self, enabled: bool, speed: float) -> dict:
        """
        Apply a new speed multiplier.

        Args:
            enabled: Whether speed hack is active.
            speed:   Multiplier value (e.g. 2.0 = double speed).

        Returns:
            {"message": str}
        """
        speed = max(0.1, min(speed, 32.0))  # clamp to sane range
        settings = _load_settings()
        settings["enabled"] = enabled
        settings["speed"] = speed
        _save_settings(settings)

        factor = speed if enabled else 1.0
        _write_factor(factor)

        msg = f"Speed set to {factor}x" if enabled else "Speed hack disabled (1.0x)"
        decky_plugin.logger.info(msg)
        return {"message": msg}

    async def install_library(self) -> dict:
        """
        Compile speedhack.c and install libspeedhack.so into the plugin bin dir.
        Requires gcc to be present on the system.
        """
        bin_dir = os.path.dirname(LIB_INSTALL)
        os.makedirs(bin_dir, exist_ok=True)

        src = os.path.join(LIB_SRC_DIR, "speedhack.c")
        cmd = ["gcc", "-shared", "-fPIC", "-O2", "-o", LIB_INSTALL, src, "-ldl"]

        try:
            result = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await result.communicate()
            if result.returncode != 0:
                msg = f"Build failed: {stderr.decode().strip()}"
                decky_plugin.logger.error(msg)
                return {"message": msg}

            msg = f"Library installed at {LIB_INSTALL}"
            decky_plugin.logger.info(msg)
            return {"message": msg}

        except FileNotFoundError:
            msg = "gcc not found — install base-devel or gcc"
            decky_plugin.logger.error(msg)
            return {"message": msg}

    async def get_launch_option(self) -> dict:
        """
        Return the Steam launch option string the user should add to a game.

        The user adds this via:
          Steam Library → right-click game → Properties → Launch Options
        """
        if not os.path.exists(LIB_INSTALL):
            return {
                "message": (
                    "Library not built yet — click 'Build & Install Library' first, "
                    "then come back here."
                )
            }

        option = f"LD_PRELOAD={LIB_INSTALL} %command%"
        decky_plugin.logger.info("Launch option: %s", option)
        return {"message": option}
