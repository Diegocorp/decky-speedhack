import {
  ButtonItem,
  DialogButton,
  PanelSection,
  PanelSectionRow,
  ServerAPI,
  SliderField,
  staticClasses,
  ToggleField,
} from "decky-frontend-lib";
import React, { useEffect, useState, VFC } from "react";
import { FaFastForward } from "react-icons/fa";

// ---------------------------------------------------------------------------
// Steam internal API helpers (available in the Decky/Steam frontend context)
// ---------------------------------------------------------------------------

const SteamClient = (window as any).SteamClient;

/** Returns the AppID of the currently running game, or null. */
function getRunningAppId(): number | null {
  try {
    const apps: Map<number, any> =
      (window as any).collectionStore?.allAppsCollection?.apps;
    if (!apps) return null;
    for (const [id, app] of apps) {
      if (app.isRunning) return id;
    }
  } catch {}
  return null;
}

/** Returns display name for an AppID. */
function getAppName(appId: number): string {
  try {
    const app = (window as any).collectionStore?.allAppsCollection?.apps?.get(appId);
    return app?.display_name ?? `App ${appId}`;
  } catch {}
  return `App ${appId}`;
}

/** Reads the current launch options for an AppID via Steam's API. */
async function getAppLaunchOptions(appId: number): Promise<string> {
  try {
    const details = await SteamClient?.Apps?.GetAppOverviewByAppID?.(appId);
    return details?.launch_options ?? "";
  } catch {}
  return "";
}

/** Writes new launch options for an AppID via Steam's API. */
async function setAppLaunchOptions(appId: number, options: string): Promise<void> {
  await SteamClient?.Apps?.SetAppLaunchOptions?.(appId, options);
}

const LD_PRELOAD_MARKER = "libspeedhack.so";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const infoBoxStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.07)",
  borderRadius: "4px",
  padding: "8px",
  fontSize: "11px",
  wordBreak: "break-all",
  lineHeight: "1.6",
  color: "#c6d4df",
};

const hintStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "#8b929a",
  marginTop: "4px",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  serverAPI: ServerAPI;
}

const SpeedHackContent: VFC<Props> = ({ serverAPI }) => {
  const [enabled, setEnabled]           = useState(false);
  const [speed, setSpeed]               = useState(1.0);
  const [speedStatus, setSpeedStatus]   = useState("");

  const [runningAppId, setRunningAppId] = useState<number | null>(null);
  const [appName, setAppName]           = useState("");
  const [appConfigured, setAppConfigured] = useState(false);
  const [libPath, setLibPath]           = useState("");
  const [setupMsg, setSetupMsg]         = useState("");

  // -------------------------------------------------------------------------
  // On mount: load state + detect running game
  // -------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      // Restore speed state
      const stateRes = await serverAPI.callPluginMethod<{}, { enabled: boolean; speed: number }>(
        "get_state", {}
      );
      if (stateRes.success) {
        setEnabled(stateRes.result.enabled);
        setSpeed(stateRes.result.speed);
      }

      // Get library path from backend
      const pathRes = await serverAPI.callPluginMethod<{}, { path: string }>(
        "get_lib_path", {}
      );
      if (pathRes.success) setLibPath(pathRes.result.path);

      // Detect running game
      refreshRunningGame();
    })();
  }, []);

  const refreshRunningGame = async () => {
    const appId = getRunningAppId();
    setRunningAppId(appId);
    if (appId) {
      setAppName(getAppName(appId));
      const opts = await getAppLaunchOptions(appId);
      setAppConfigured(opts.includes(LD_PRELOAD_MARKER));
    }
  };

  // -------------------------------------------------------------------------
  // Speed control
  // -------------------------------------------------------------------------
  const applySpeed = async (newEnabled: boolean, newSpeed: number) => {
    const res = await serverAPI.callPluginMethod<
      { enabled: boolean; speed: number },
      { message: string }
    >("set_speed", { enabled: newEnabled, speed: newSpeed });
    if (res.success) setSpeedStatus(res.result.message);
  };

  const handleToggle = async (val: boolean) => {
    setEnabled(val);
    await applySpeed(val, speed);
  };

  const handleSlider = async (val: number) => {
    const mapped = parseFloat((val * 0.25).toFixed(2));
    setSpeed(mapped);
    if (enabled) await applySpeed(true, mapped);
  };

  // -------------------------------------------------------------------------
  // Per-game setup — uses Steam's own API, no copy-paste needed
  // -------------------------------------------------------------------------
  const handleEnable = async () => {
    if (!runningAppId || !libPath) return;
    setSetupMsg("Applying...");
    try {
      const current = await getAppLaunchOptions(runningAppId);
      // Avoid duplicates
      const cleaned = current.replace(/LD_PRELOAD=[^\s]+ /g, "").trim();
      const newOpts = `LD_PRELOAD=${libPath} ${cleaned || "%command%"}`.trim();
      await setAppLaunchOptions(runningAppId, newOpts);
      setAppConfigured(true);
      setSetupMsg("Done! Restart the game once to activate.");
    } catch (e) {
      setSetupMsg(`Error: ${e}`);
    }
  };

  const handleDisable = async () => {
    if (!runningAppId) return;
    setSetupMsg("Removing...");
    try {
      const current = await getAppLaunchOptions(runningAppId);
      const cleaned = current.replace(/LD_PRELOAD=[^\s]+ ?/g, "").trim();
      await setAppLaunchOptions(runningAppId, cleaned);
      setAppConfigured(false);
      setSetupMsg("Removed. Restart game to fully deactivate.");
    } catch (e) {
      setSetupMsg(`Error: ${e}`);
    }
  };

  const sliderValue = Math.round(speed / 0.25);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      {/* ── Speed control ── */}
      <PanelSection title="Speed Control">
        <PanelSectionRow>
          <ToggleField
            label="Enable Speed Hack"
            description={speedStatus || (enabled ? `Active at ${speed}x` : "Disabled")}
            checked={enabled}
            onChange={handleToggle}
          />
        </PanelSectionRow>

        <PanelSectionRow>
          <SliderField
            label={`Speed: ${speed}x`}
            value={sliderValue}
            min={1} max={32} step={1}
            disabled={!enabled}
            onChange={handleSlider}
            notchCount={5}
            notchLabels={[
              { notchIndex: 1,  label: "0.25x" },
              { notchIndex: 4,  label: "1x"    },
              { notchIndex: 8,  label: "2x"    },
              { notchIndex: 16, label: "4x"    },
              { notchIndex: 32, label: "8x"    },
            ]}
          />
        </PanelSectionRow>
      </PanelSection>

      {/* ── Per-game setup ── */}
      <PanelSection title="Game Setup">
        <PanelSectionRow>
          <div style={{ width: "100%" }}>
            {runningAppId ? (
              <div style={infoBoxStyle}>
                <div><b>{appName}</b></div>
                <div style={{ marginTop: "4px" }}>
                  {appConfigured
                    ? "✓ SpeedHack enabled for this game"
                    : "⚠ Not yet enabled for this game"}
                </div>
              </div>
            ) : (
              <div style={infoBoxStyle}>No game running</div>
            )}
          </div>
        </PanelSectionRow>

        {runningAppId && (
          <PanelSectionRow>
            {appConfigured
              ? React.createElement(DialogButton as React.ElementType, {
                  onClick: handleDisable,
                }, "Remove from this game")
              : React.createElement(DialogButton as React.ElementType, {
                  onClick: handleEnable,
                }, "Enable for this game")}
          </PanelSectionRow>
        )}

        {/* Refresh button in case game changed */}
        <PanelSectionRow>
          <ButtonItem
            label="Refresh running game"
            layout="below"
            onClick={refreshRunningGame}
          />
        </PanelSectionRow>

        {setupMsg !== "" && (
          <PanelSectionRow>
            <div style={hintStyle}>{setupMsg}</div>
          </PanelSectionRow>
        )}

        {appConfigured && (
          <PanelSectionRow>
            <div style={hintStyle}>
              First time? Restart the game once. After that, the speed slider
              works live — no restart needed.
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>
    </>
  );
};

export default (serverApi: ServerAPI) => ({
  title: React.createElement("div", { className: staticClasses.Title }, "SpeedHack"),
  content: React.createElement(SpeedHackContent, { serverAPI: serverApi }),
  icon: React.createElement(FaFastForward, null),
  onDismount() {},
});
