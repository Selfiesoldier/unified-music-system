"""
Anchor Guardian Loop - Anti-drift & Auto-docking Position Watchdog.

Inspired by pakbotgem's startAnchorGuardian system:
1. Performs staggered initial repositioning (1s, 2.5s, 4s) to firmly dock the bot as room loads.
2. Runs a continuous lightweight watchdog every 4 seconds.
3. Automatically detects drift, displacement, or bumps (> 0.4m), or furniture anchor mismatches,
   and snaps the bot back to its exact anchor coordinates/seat.

BLOCKED-POSITION DETECTION (v2):
- If the bot keeps bouncing back to the same live position after N consecutive teleport attempts,
  the target coordinate is inside a collision zone / invalid navmesh tile (Highrise physics rejection).
- In this case the guardian STOPS fighting the physics engine, notifies the room once,
  and backs off for 60 seconds before retrying — preventing the rubberbanding loop.
"""
import asyncio
import math
import sys
import time
from highrise import Position, AnchorPosition
from core.error_handler import safe_call
from core.logger import write_system_log

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

# ── Blocked-position state (module-level so it persists across ticks) ──────────
_drift_history: list[float] = []          # rolling window of last N drift values
_BLOCKED_THRESHOLD = 3                    # how many consecutive same-drift ticks = blocked
_BLOCKED_TOLERANCE = 0.15                 # two drift values are "same" if within this margin
_blocked_until: float = 0.0              # epoch time until which guardian stays quiet
_BLOCKED_BACKOFF = 60.0                  # seconds to pause after detecting blocked position
_blocked_notified: bool = False           # only notify room chat once per block episode
# ───────────────────────────────────────────────────────────────────────────────


async def anchor_guardian_loop(bot):
    """Periodically monitors and anchors the bot avatar to its designated position."""
    print("⚓ Anchor Guardian watchdog initialized, running startup docking...")
    write_system_log("Anchor Guardian loop started")

    # Staggered initial triggers (1.0s, 2.5s, 4.0s) to guarantee bot arrives at home
    # regardless of room loading time or asset synchronization.
    try:
        await asyncio.sleep(1.0)
        await _ensure_home(bot, "Initial startup dock (1.0s)")
        await asyncio.sleep(1.5)
        await _ensure_home(bot, "Initial startup dock (2.5s)")
        await asyncio.sleep(1.5)
        await _ensure_home(bot, "Initial startup dock (4.0s)")
    except asyncio.CancelledError:
        raise
    except Exception as e:
        print(f"⚠️ Startup docking notice: {e}")

    print("✅ Anchor Guardian loop active and watching!")

    while True:
        try:
            await safe_call(lambda: _anchor_guardian_tick(bot))
        except asyncio.CancelledError:
            raise
        except Exception as e:
            err = str(e).lower()
            if "closing" not in err and "connection" not in err and "transport" not in err:
                print(f"⚠️ Anchor Guardian tick error: {e}")

        # Watchdog interval: 4 seconds (ultra-efficient, matches pakbotgem)
        await asyncio.sleep(4.0)


async def _ensure_home(bot, reason: str = ""):
    """Helper to snap the bot back to its saved anchor position."""
    if not bot or not bot.bot_user_id or not bot.position_manager:
        return
    if not bot.position_manager.has_position():
        return

    home = bot.position_manager.get_position()
    if not home:
        return

    await bot.position_manager.ensure_home_position(bot)


def _is_same_drift(a: float, b: float) -> bool:
    """Returns True if two drift readings are close enough to count as the same bounce."""
    return abs(a - b) <= _BLOCKED_TOLERANCE


def _detect_blocked_position(new_drift: float) -> bool:
    """
    Tracks the last N drift readings. Returns True if the position appears blocked
    (i.e., Highrise physics keeps bouncing the bot back to the same spot).
    """
    global _drift_history
    _drift_history.append(new_drift)

    # Keep only the last N readings
    if len(_drift_history) > _BLOCKED_THRESHOLD:
        _drift_history = _drift_history[-_BLOCKED_THRESHOLD:]

    if len(_drift_history) < _BLOCKED_THRESHOLD:
        return False

    # All readings must be within tolerance of the first
    first = _drift_history[0]
    return all(_is_same_drift(first, d) for d in _drift_history[1:])


async def _anchor_guardian_tick(bot):
    """Executes a single watchdog check comparing live avatar position with saved anchor."""
    global _drift_history, _blocked_until, _blocked_notified

    if not bot or not bot.bot_user_id or not bot.position_manager:
        return

    # Grace period: do not interfere if a manual position command was recently executed
    last_move = getattr(bot.position_manager, '_last_manual_move', 0)
    if time.time() - last_move < 12.0:
        # Reset block state when user manually moves the bot — fresh start
        _drift_history.clear()
        _blocked_until = 0.0
        _blocked_notified = False
        return

    home = bot.position_manager.get_position()
    if not home:
        return

    # ── Blocked-position back-off ───────────────────────────────────────────────
    if time.time() < _blocked_until:
        return  # Silently wait out the back-off period
    elif _blocked_until > 0.0:
        # Back-off expired — reset state and try again with a clean slate
        _drift_history.clear()
        _blocked_until = 0.0
        _blocked_notified = False
        print("⚓ [Anchor Guardian] Retrying after blocked-position back-off.")
    # ───────────────────────────────────────────────────────────────────────────

    # Check live position in room
    try:
        response = await bot.highrise.get_room_users()
    except Exception:
        return

    if not hasattr(response, 'content'):
        return

    bot_live_pos = None
    for room_user, pos in response.content:
        if room_user.id == bot.bot_user_id:
            bot_live_pos = pos
            break

    if not bot_live_pos:
        return

    # Case 1: Saved home is an AnchorPosition (furniture / chair / booth)
    if isinstance(home, AnchorPosition):
        if (
            not isinstance(bot_live_pos, AnchorPosition)
            or bot_live_pos.entity_id != home.entity_id
            or bot_live_pos.anchor_ix != home.anchor_ix
        ):
            print(f"⚓ [Anchor Guardian] Furniture anchor displacement detected. Reseating bot to {home.entity_id} #{home.anchor_ix}")
            write_system_log(f"Anchor Guardian: Reseating bot to furniture anchor {home.entity_id} #{home.anchor_ix}")
            await bot.position_manager.ensure_home_position(bot)
        else:
            # Bot is correctly on its anchor — clear any drift history
            _drift_history.clear()
        return

    # Case 2: Saved home is a standard coordinate Position
    if isinstance(home, Position):
        # If bot is currently sitting on furniture while home is a coordinate spot
        if isinstance(bot_live_pos, AnchorPosition):
            print(f"⚓ [Anchor Guardian] Bot is on furniture while home is coordinate spot ({home.x:.1f}, {home.y:.1f}, {home.z:.1f}). Snapping back...")
            write_system_log("Anchor Guardian: Snapping bot from furniture back to coordinate home")
            _drift_history.clear()
            await bot.position_manager.ensure_home_position(bot)
            return

        # Both are Positions: calculate drift distance
        if isinstance(bot_live_pos, Position):
            dist = math.hypot(bot_live_pos.x - home.x, bot_live_pos.z - home.z) + abs(bot_live_pos.y - home.y)

            if dist <= 0.85:
                # Bot is at home — clear drift history, everything is fine
                _drift_history.clear()
                _blocked_notified = False
                return

            # ── Blocked-position detection ──────────────────────────────────────
            is_blocked = _detect_blocked_position(dist)
            if is_blocked:
                # The bot keeps bouncing back to the same distance.
                # This means the saved coordinate is inside a collision/physics zone.
                _blocked_until = time.time() + _BLOCKED_BACKOFF

                warn_msg = (
                    f"⚠️ Anchor Guardian: Saved position ({home.x:.1f}, {home.y:.1f}, {home.z:.1f}) "
                    f"appears to be inside a collision zone (bot bounces back {dist:.2f}m every time). "
                    f"Pausing for {int(_BLOCKED_BACKOFF)}s. Use /setmusicbot to pick a valid floor tile."
                )
                print(warn_msg)
                write_system_log(
                    f"Anchor Guardian: BLOCKED position detected at ({home.x:.1f},{home.y:.1f},{home.z:.1f}) "
                    f"— consistent {dist:.2f}m bounce. Backing off for {int(_BLOCKED_BACKOFF)}s."
                )

                if not _blocked_notified:
                    _blocked_notified = True
                    try:
                        # Notify the room in chat so the admin knows
                        await bot.highrise.chat(
                            f"⚓ My saved spot seems to be inside a wall or collision zone "
                            f"(I keep bouncing {dist:.2f}m away). "
                            f"Please use /setmusicbot to place me on a valid floor tile!"
                        )
                    except Exception:
                        pass
                return
            # ────────────────────────────────────────────────────────────────────

            # Normal drift — snap back
            print(f"⚓ [Anchor Guardian] Drift detected ({dist:.2f}m). Live: ({bot_live_pos.x:.2f}, {bot_live_pos.y:.2f}, {bot_live_pos.z:.2f}) -> Snapping back to: ({home.x:.2f}, {home.y:.2f}, {home.z:.2f})")
            write_system_log(f"Anchor Guardian: Snapped bot back to anchor (drift: {dist:.2f}m)")
            await bot.position_manager.ensure_home_position(bot)
