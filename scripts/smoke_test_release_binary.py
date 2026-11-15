#!/usr/bin/env python3
"""Hard runtime smoke gate for packaged Outrider release artifacts.

Extracts each archive/installer into an isolated directory outside the repository,
launches the packaged `outrider` binary against a fresh SQLite database, and verifies:
  1. Embedded HeroUI Pro dashboard (`/__proxyfor__/`, hashed `/_next/static/*.js`, zero UI traffic pollution)
  2. Public runtime & native LiteRT-LM C-API link check (`/__proxyfor__/commerce/status`)
  3. Admin bearer authentication & loopback local bootstrap (`401`/`403`/`200` + DNS-rebind/CSRF rejection)
  4. Live MCP `2026-07-28` wire session (`POST /mcp` + unified `Traffic` & `subscribe/traffics` verification)
  5. Live TLS 1.3 loopback `rmcp` sortie (`POST /onboarding/run-sortie`) + Ed25519 receipt signature verification
  6. Graceful shutdown & SQLite `PRAGMA integrity_check == 'ok'`
"""
import argparse
import json
import os
import pathlib
import plistlib
import re
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zipfile


def pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def http_request(
    url: str,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    json_body: object | None = None,
    timeout: float = 30.0,
) -> tuple[int, dict[str, str], bytes]:
    req_headers = dict(headers or {})
    data: bytes | None = None
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers.items()), resp.read()
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers.items()), err.read()


def parse_json_or_sse(raw: bytes, content_type: str) -> dict:
    text = raw.decode("utf-8", errors="replace").strip()
    if "text/event-stream" in content_type.lower() or text.startswith("event:") or text.startswith("data:"):
        payloads = []
        for line in text.splitlines():
            if line.startswith("data:"):
                candidate = line[len("data:") :].strip()
                if candidate:
                    payloads.append(json.loads(candidate))
        if not payloads:
            raise AssertionError(f"SSE stream contained no JSON data lines: {text[:400]}")
        return payloads[-1]
    return json.loads(text)


def run_six_live_checks(exe_path: pathlib.Path, work_dir: pathlib.Path, label: str) -> None:
    print(f"[smoke] Running 6 live runtime checks for {label} ({exe_path}) ...")
    cfg_dir = work_dir / "cfg"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    db_path = work_dir / "outrider-smoke.db"
    port = pick_free_port()
    base_url = f"http://127.0.0.1:{port}"

    env = dict(os.environ)
    env.pop("OUTRIDER_CLEF_MODEL", None)
    env.pop("OUTRIDER_DASHBOARD_DIR", None)
    env.pop("LD_LIBRARY_PATH", None)
    env.pop("DYLD_LIBRARY_PATH", None)
    env.pop("DYLD_FALLBACK_LIBRARY_PATH", None)
    env["OUTRIDER_CLEF_NO_FETCH"] = "1"
    env["CI"] = "true"

    proc = subprocess.Popen(
        [
            str(exe_path),
            "--headless",
            "--web",
            "--probe-policy",
            "on-request",
            "--listen",
            f"127.0.0.1:{port}",
            "--config-dir",
            str(cfg_dir),
            "--db",
            str(db_path),
        ],
        cwd=str(work_dir),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        # Wait for HTTP listener readiness
        deadline = time.monotonic() + 30.0
        status_json = None
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                out, err = proc.communicate(timeout=5)
                raise RuntimeError(
                    f"Binary exited prematurely with code {proc.returncode}.\nSTDOUT:\n{out.decode(errors='replace')}\nSTDERR:\n{err.decode(errors='replace')}"
                )
            try:
                code, _, body = http_request(f"{base_url}/__proxyfor__/commerce/status", timeout=2.0)
                if code == 200:
                    status_json = json.loads(body.decode("utf-8"))
                    break
            except Exception:
                pass
            time.sleep(0.15)

        if status_json is None:
            raise TimeoutError(f"Timed out waiting for {base_url}/__proxyfor__/commerce/status")

        # Check 1: Embedded HeroUI Dashboard and hashed Next.js static chunks (excluded from traffics)
        code_root, _, html_root_bytes = http_request(f"{base_url}/__proxyfor__/")
        assert code_root == 200, f"Expected 200 on /__proxyfor__/, got {code_root}"
        html_root = html_root_bytes.decode("utf-8", errors="replace")
        assert "<html" in html_root.lower(), "Embedded /__proxyfor__/ HTML missing document root"

        chunk_match = re.search(r'(/__proxyfor__/_next/static/[^"\'\s>]+\.js)', html_root)
        assert chunk_match is not None, "Could not find hashed /_next/static/*.js asset in /__proxyfor__/ HTML"
        chunk_path = chunk_match.group(1)
        code_js, js_headers, js_bytes = http_request(f"{base_url}{chunk_path}")
        assert code_js == 200 and len(js_bytes) > 100, f"Static JS chunk {chunk_path} failed: {code_js}"

        code_ui_traffics, _, ui_traffics_bytes = http_request(f"{base_url}/__proxyfor__/traffics")
        assert code_ui_traffics == 200, f"Expected 200 on /__proxyfor__/traffics, got {code_ui_traffics}"
        assert json.loads(ui_traffics_bytes.decode("utf-8")) == [], (
            f"Expected /__proxyfor__/ UI requests to be excluded from /traffics, got {ui_traffics_bytes!r}"
        )
        print(f"[smoke]   1/6 Embedded HeroUI dashboard and {chunk_path} verified (0 UI traffic pollution).")

        # Check 2: Public status & native LiteRT-LM C API link state
        assert "clef" in status_json and "status" in status_json["clef"], f"Malformed status: {status_json}"
        assert status_json.get("mcp_endpoint") == f"{base_url}/mcp", f"Unexpected mcp_endpoint: {status_json}"
        print(f"[smoke]   2/6 Native runtime & commerce status verified (clef={status_json['clef']['status']}).")

        # Check 3: Admin token enforcement (401/200) & loopback /bootstrap/local security gates
        token_file = cfg_dir / "outrider-admin-token"
        assert token_file.is_file(), f"Missing generated admin token at {token_file}"
        admin_token = token_file.read_text(encoding="utf-8").strip()
        assert len(admin_token) >= 32, "Admin token unexpectedly short"

        code_unauth, _, _ = http_request(f"{base_url}/__proxyfor__/commerce/snapshot")
        assert code_unauth == 401, f"Expected 401 for unauthenticated snapshot, got {code_unauth}"

        c_rebind, _, _ = http_request(
            f"{base_url}/__proxyfor__/commerce/bootstrap/local",
            method="POST",
            headers={"Host": "evil.example", "x-outrider-client": "dashboard"},
        )
        assert c_rebind == 403, f"Expected 403 for DNS-rebind Host on /bootstrap/local, got {c_rebind}"

        c_no_csrf, _, _ = http_request(
            f"{base_url}/__proxyfor__/commerce/bootstrap/local",
            method="POST",
            headers={"Host": f"localhost:{port}"},
        )
        assert c_no_csrf == 403, f"Expected 403 when missing x-outrider-client on /bootstrap/local, got {c_no_csrf}"

        c_local_ok, _, b_local_ok = http_request(
            f"{base_url}/__proxyfor__/commerce/bootstrap/local",
            method="POST",
            headers={"Host": f"localhost:{port}", "x-outrider-client": "dashboard"},
        )
        assert c_local_ok == 200, f"Expected 200 on loopback /bootstrap/local, got {c_local_ok}"
        assert json.loads(b_local_ok.decode("utf-8")).get("token") == admin_token, (
            "Mismatch in /bootstrap/local token"
        )

        auth_headers = {"Authorization": f"Bearer {admin_token}"}
        code_auth, _, snap_bytes = http_request(
            f"{base_url}/__proxyfor__/commerce/snapshot",
            headers=auth_headers,
        )
        assert code_auth == 200, f"Expected 200 for bearer-authenticated snapshot, got {code_auth}"
        initial_snap = json.loads(snap_bytes.decode("utf-8"))
        assert initial_snap.get("fingerprint_observations") == [], (
            f"Expected /__proxyfor__/ UI requests not to pollute fingerprint_observations: {initial_snap.get('fingerprint_observations')}"
        )
        print("[smoke]   3/6 Admin bearer token enforcement, /bootstrap/local, and zero UI fingerprinting verified.")

        # Check 4: Live MCP `2026-07-28` wire session (`server/discover` -> `tools/list` -> `tools/call`)
        mcp_secret = str(uuid.uuid4())
        mcp_base_headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": "2026-07-28",
            "outrider-session-id": mcp_secret,
        }
        mcp_meta = {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {
                "name": "outrider-release-smoke-gate",
                "version": "1.0.0",
            },
        }
        c_disc, h_disc, b_disc = http_request(
            f"{base_url}/mcp",
            method="POST",
            headers={**mcp_base_headers, "Mcp-Method": "server/discover"},
            json_body={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "server/discover",
                "params": {"_meta": mcp_meta},
            },
        )
        assert c_disc == 200, f"MCP server/discover failed ({c_disc}): {b_disc.decode(errors='replace')}"
        disc_rpc = parse_json_or_sse(b_disc, h_disc.get("Content-Type", ""))
        assert "2026-07-28" in json.dumps(disc_rpc), f"Unexpected server/discover payload: {disc_rpc}"

        c_list, h_list, b_list = http_request(
            f"{base_url}/mcp",
            method="POST",
            headers={**mcp_base_headers, "Mcp-Method": "tools/list"},
            json_body={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {"_meta": mcp_meta},
            },
        )
        assert c_list == 200, f"MCP tools/list failed ({c_list}): {b_list.decode(errors='replace')}"
        list_rpc = parse_json_or_sse(b_list, h_list.get("Content-Type", ""))
        tool_names = [t.get("name") for t in list_rpc.get("result", {}).get("tools", [])]
        assert "outrider_catalog" in tool_names, f"Missing outrider_catalog in tools/list: {tool_names}"

        c_call, h_call, b_call = http_request(
            f"{base_url}/mcp",
            method="POST",
            headers={
                **mcp_base_headers,
                "Mcp-Method": "tools/call",
                "Mcp-Name": "outrider_catalog",
            },
            json_body={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"_meta": mcp_meta, "name": "outrider_catalog", "arguments": {}},
            },
        )
        assert c_call == 200, f"MCP tools/call outrider_catalog failed ({c_call}): {b_call.decode(errors='replace')}"
        call_rpc = parse_json_or_sse(b_call, h_call.get("Content-Type", ""))
        assert "result" in call_rpc and not call_rpc["result"].get("isError"), f"Unexpected tool result: {call_rpc}"

        c_traffics, _, b_traffics = http_request(f"{base_url}/__proxyfor__/traffics")
        assert c_traffics == 200, f"Expected 200 on /__proxyfor__/traffics, got {c_traffics}"
        traffics_list = json.loads(b_traffics.decode("utf-8"))
        mcp_heads = [t for t in traffics_list if str(t.get("uri", "")).endswith("/mcp")]
        assert len(mcp_heads) >= 3, f"Expected >=3 /mcp entries in /__proxyfor__/traffics, got {traffics_list}"
        assert all(
            isinstance(t.get("start_time_unix_ms"), int) and t["start_time_unix_ms"] > 0
            for t in mcp_heads
        ), f"Missing start_time_unix_ms on /mcp TrafficHead: {mcp_heads}"

        sub_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with sub_opener.open(f"{base_url}/__proxyfor__/subscribe/traffics", timeout=5.0) as sub_resp:
            first_ndjson = sub_resp.readline().decode("utf-8").strip()
        first_head = json.loads(first_ndjson)
        assert str(first_head.get("uri", "")).endswith("/mcp") and isinstance(
            first_head.get("start_time_unix_ms"), int
        ), f"Unexpected /subscribe/traffics NDJSON frame: {first_head}"
        print("[smoke]   4/6 Live MCP 2026-07-28 session & unified /traffics stream verified.")

        # Check 5: Cryptographic Commerce + TLS 1.3 Loopback `rmcp` Sortie + Ed25519 Receipt Verification
        c_sortie, _, b_sortie = http_request(
            f"{base_url}/__proxyfor__/commerce/onboarding/run-sortie",
            method="POST",
            headers=auth_headers,
            json_body={"client_name": "Release Smoke Gate Agent"},
            timeout=45.0,
        )
        assert c_sortie == 200, f"TLS loopback sortie failed ({c_sortie}): {b_sortie.decode(errors='replace')}"
        sortie_res = json.loads(b_sortie.decode("utf-8"))
        assert sortie_res.get("receipt_id"), f"Missing receipt_id in sortie response: {sortie_res}"
        assert sortie_res.get("proxy_traffic_recorded") is True, f"Proxy traffic not recorded: {sortie_res}"

        _, _, final_snap_bytes = http_request(
            f"{base_url}/__proxyfor__/commerce/snapshot",
            headers=auth_headers,
        )
        snap = json.loads(final_snap_bytes.decode("utf-8"))
        assert len(snap["agent_sessions"]) >= 2, f"Expected >=2 agent_sessions, got {len(snap['agent_sessions'])}"
        assert any(s["state"] == "Entitled" for s in snap["agent_sessions"]), "No Entitled session recorded"
        obs_kinds = {o["kind"] for o in snap["fingerprint_observations"]}
        for required_kind in ("client_hello", "negotiated_tls", "http_header_order", "mcp_request"):
            assert required_kind in obs_kinds, f"Missing {required_kind} in observations: {obs_kinds}"
        assert len(snap["mrtr_quotes"]) >= 1, "Expected >=1 persisted MRTR quote"
        assert len(snap["capability_receipts"]) >= 1, "Expected >=1 persisted capability receipt"
        assert all(
            r["signature_verified"] is True for r in snap["capability_receipts"]
        ), "Ed25519 receipt signature_verified was not True"
        assert len(snap["receipt_redemptions"]) >= 1, "Expected >=1 receipt redemption"
        print("[smoke]   5/6 Live TLS 1.3 JA4 + MRTR quote + Ed25519 receipt redemption verified.")

        # Check 6: Graceful shutdown & SQLite integrity check
        if sys.platform == "win32":
            proc.terminate()
        else:
            proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
            raise RuntimeError("Process did not shut down cleanly within 10s")

        conn = sqlite3.connect(str(db_path))
        try:
            integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
            session_count = conn.execute("SELECT COUNT(*) FROM agent_sessions").fetchone()[0]
        finally:
            conn.close()
        assert integrity == "ok", f"SQLite integrity_check failed: {integrity}"
        assert session_count >= 2, f"Expected >=2 persisted SQLite sessions after shutdown, got {session_count}"
        print(f"[smoke]   6/6 Clean shutdown & SQLite integrity ('{integrity}', {session_count} sessions) verified.")
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)
        if proc.stdout is not None:
            proc.stdout.close()
        if proc.stderr is not None:
            proc.stderr.close()


def smoke_test_artifact(artifact_path: pathlib.Path) -> None:
    if not artifact_path.is_file():
        sys.exit(f"Artifact does not exist: {artifact_path}")

    name = artifact_path.name
    with tempfile.TemporaryDirectory(prefix="outrider-isolated-smoke-") as tmp:
        tmp_dir = pathlib.Path(tmp)
        unpack_dir = tmp_dir / "unpacked"
        unpack_dir.mkdir(parents=True, exist_ok=True)
        run_dir = tmp_dir / "runtime"
        run_dir.mkdir(parents=True, exist_ok=True)

        if name.endswith(".tar.gz"):
            with tarfile.open(artifact_path, "r:gz") as tf:
                tf.extractall(unpack_dir)
            candidates = list(unpack_dir.rglob("outrider"))
            exe = next((p for p in candidates if p.is_file()), None)
            if exe is None:
                sys.exit(f"No `outrider` executable found inside {artifact_path}")
            os.chmod(exe, 0o755)
            run_six_live_checks(exe, run_dir, name)
            return

        if name.endswith(".zip"):
            with zipfile.ZipFile(artifact_path, "r") as zf:
                zf.extractall(unpack_dir)
            exe_name = "outrider.exe" if sys.platform == "win32" else "outrider"
            candidates = list(unpack_dir.rglob(exe_name))
            exe = next((p for p in candidates if p.is_file()), None)
            if exe is None:
                sys.exit(f"No `{exe_name}` executable found inside {artifact_path}")
            run_six_live_checks(exe, run_dir, name)
            return

        if name.endswith(".dmg"):
            if sys.platform != "darwin":
                sys.exit(f"Cannot mount .dmg artifact {name} on non-macOS host {sys.platform}")
            mnt_dir = tmp_dir / "dmg-mount"
            mnt_dir.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                [
                    "hdiutil",
                    "attach",
                    "-nobrowse",
                    "-readonly",
                    "-mountpoint",
                    str(mnt_dir),
                    str(artifact_path),
                ],
                check=True,
            )
            try:
                mounted_app = mnt_dir / "Outrider.app"
                if not mounted_app.is_dir():
                    sys.exit(f"Outrider.app missing inside mounted DMG {artifact_path}")
                copied_app = unpack_dir / "Outrider.app"
                shutil.copytree(mounted_app, copied_app, symlinks=True)
            finally:
                subprocess.run(["hdiutil", "detach", str(mnt_dir), "-force"], check=False)

            subprocess.run(["codesign", "--verify", "--deep", "--strict", str(copied_app)], check=True)
            plist_data = plistlib.loads((copied_app / "Contents/Info.plist").read_bytes())
            assert plist_data.get("LSUIElement") is True, (
                f"Expected LSUIElement=True in Outrider.app Info.plist, got {plist_data.get('LSUIElement')}"
            )
            app_exe = copied_app / "Contents/MacOS/outrider"
            if not app_exe.is_file():
                sys.exit(f"Missing Contents/MacOS/outrider inside {copied_app}")
            run_six_live_checks(app_exe, run_dir, name)
            return

        if name.endswith(".msi"):
            if sys.platform != "win32":
                sys.exit(f"Cannot administratively extract .msi artifact {name} on non-Windows host {sys.platform}")
            msi_target = (unpack_dir / "msi-admin").resolve()
            msi_target.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                [
                    "msiexec.exe",
                    "/a",
                    str(artifact_path.resolve()),
                    "/qn",
                    f"TARGETDIR={msi_target}",
                ],
                check=True,
            )
            candidates = list(msi_target.rglob("outrider.exe"))
            exe = next((p for p in candidates if p.is_file()), None)
            if exe is None:
                sys.exit(f"No outrider.exe extracted from MSI {artifact_path}")
            run_six_live_checks(exe, run_dir, name)
            return

        sys.exit(f"Unsupported artifact extension for smoke gate: {artifact_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Execute isolated live runtime smoke checks on packaged Outrider artifacts.")
    parser.add_argument(
        "--artifact",
        action="append",
        required=True,
        help="Path to packaged artifact (.tar.gz, .zip, .dmg, or .msi). May be specified multiple times.",
    )
    args = parser.parse_args()

    for raw_path in args.artifact:
        smoke_test_artifact(pathlib.Path(raw_path).resolve())

    print(f"[smoke] ALL {len(args.artifact)} ARTIFACT(S) PASSED LIVE RUNTIME VERIFICATION.")


if __name__ == "__main__":
    main()
