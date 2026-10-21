import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import a2s


def required_environment(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def fetch_gameserver(token, service_id):
    url = (
        "https://api.nitrado.net/services/"
        f"{urllib.parse.quote(service_id, safe='')}/gameservers"
    )
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        data = json.load(response)

    gameserver = data.get("data", {}).get("gameserver", {})
    status = gameserver.get("status")
    if data.get("status") != "success" or status not in ("started", "stopped"):
        raise RuntimeError("Nitrado did not return a stable server status")
    return status, gameserver


def query_server(gameserver):
    host = gameserver.get("ip")
    port = gameserver.get("query_port")
    if not host or not isinstance(port, int):
        return None

    address = (host, port)
    started_at = time.monotonic()
    try:
        info = a2s.info(address, timeout=4)
    except Exception:
        print("ARK server query unavailable; sending status with missing live stats.")
        return None

    report = {
        "pingMs": round((time.monotonic() - started_at) * 1000),
        "mapName": getattr(info, "map_name", None),
        "playerCount": getattr(info, "player_count", None),
        "maxPlayers": getattr(info, "max_players", None),
    }

    try:
        players = a2s.players(address, timeout=4)
        report["players"] = [
            {
                "name": player.name,
                "durationSeconds": max(0, int(player.duration)),
            }
            for player in players
        ]
    except Exception:
        print("ARK player query unavailable; player connection times will be omitted.")

    return report


def main():
    token = required_environment("NITRADO_API_TOKEN")
    service_id = required_environment("NITRADO_SERVICE_ID")
    monitor_url = required_environment("MONITOR_URL").rstrip("/")
    monitor_secret = required_environment("MONITOR_SECRET")

    status, gameserver = fetch_gameserver(token, service_id)
    report = query_server(gameserver) if status == "started" else None
    payload = json.dumps({"report": report}).encode("utf-8")
    request = urllib.request.Request(
        f"{monitor_url}/api/server-status",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {monitor_secret}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(
            f"Status monitor request failed with HTTP {error.code}"
        ) from None

    if result.get("status") != status or result.get("reportSent") is not True:
        raise RuntimeError("Status monitor did not confirm sending the report")
    print("Discord server status report sent.")


if __name__ == "__main__":
    main()
