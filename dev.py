from __future__ import annotations

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="启动 autoschedule，并在隐私浏览窗口中打开。"
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="先执行生产构建，再启动预览服务（默认启动支持热更新的开发服务）。",
    )
    parser.add_argument(
        "--port",
        type=int,
        help="指定服务端口；省略时自动选择空闲端口。",
    )
    return parser.parse_args()


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind((HOST, 0))
        return int(listener.getsockname()[1])


def find_npm() -> str:
    command = "npm.cmd" if os.name == "nt" else "npm"
    executable = shutil.which(command)
    if executable is None:
        raise RuntimeError("未找到 npm，请先安装 Node.js 并确认 npm 已加入 PATH。")
    return executable


def browser_candidates() -> list[tuple[Path, list[str]]]:
    candidates: list[tuple[Path, list[str]]] = []

    if sys.platform == "win32":
        roots = filter(
            None,
            (
                os.environ.get("PROGRAMFILES"),
                os.environ.get("PROGRAMFILES(X86)"),
                os.environ.get("LOCALAPPDATA"),
            ),
        )
        for root in roots:
            candidates.extend(
                [
                    (Path(root) / "Microsoft/Edge/Application/msedge.exe", ["--inprivate"]),
                    (Path(root) / "Google/Chrome/Application/chrome.exe", ["--incognito"]),
                ]
            )
    elif sys.platform == "darwin":
        candidates.extend(
            [
                (
                    Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
                    ["--incognito"],
                ),
                (
                    Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
                    ["--inprivate"],
                ),
                (
                    Path("/Applications/Firefox.app/Contents/MacOS/firefox"),
                    ["--private-window"],
                ),
            ]
        )

    path_commands = [
        ("msedge", ["--inprivate"]),
        ("microsoft-edge", ["--inprivate"]),
        ("google-chrome", ["--incognito"]),
        ("chrome", ["--incognito"]),
        ("chromium", ["--incognito"]),
        ("firefox", ["--private-window"]),
    ]
    for command, private_args in path_commands:
        executable = shutil.which(command)
        if executable:
            candidates.append((Path(executable), private_args))

    return candidates


def find_private_browser() -> tuple[Path, list[str]]:
    for executable, private_args in browser_candidates():
        if executable.is_file():
            return executable, private_args
    raise RuntimeError(
        "未找到支持隐私窗口的 Edge、Chrome 或 Firefox，请先安装其中一个浏览器。"
    )


def wait_until_ready(process: subprocess.Popen[bytes], url: str) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"开发服务已异常退出，退出码为 {process.returncode}。")
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except urllib.error.HTTPError:
            return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.2)
    raise RuntimeError("等待开发服务启动超时，请查看上方 Vite 输出。")


def stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return

    try:
        if os.name == "nt":
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            os.killpg(process.pid, signal.SIGTERM)
    except OSError:
        return

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def main() -> int:
    args = parse_args()
    try:
        npm = find_npm()
        browser, private_args = find_private_browser()
    except RuntimeError as error:
        print(f"启动失败：{error}", file=sys.stderr, flush=True)
        return 1

    port = args.port or find_free_port()
    url = f"http://{HOST}:{port}/"

    if args.preview:
        print("正在构建生产版本...", flush=True)
        build = subprocess.run([npm, "run", "build"], cwd=PROJECT_ROOT, check=False)
        if build.returncode != 0:
            return build.returncode

    script = "preview" if args.preview else "dev"
    command = [
        npm,
        "run",
        script,
        "--",
        "--host",
        HOST,
        "--port",
        str(port),
        "--strictPort",
    ]
    process_options: dict[str, object] = {"cwd": PROJECT_ROOT}
    if os.name == "nt":
        process_options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        process_options["start_new_session"] = True

    process = subprocess.Popen(command, **process_options)
    try:
        wait_until_ready(process, url)
        print(f"已启动：{url}", flush=True)
        print(f"正在使用 {browser.name} 打开隐私窗口；按 Ctrl+C 停止服务。", flush=True)
        subprocess.Popen(
            [str(browser), *private_args, "--new-window", url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return process.wait()
    except KeyboardInterrupt:
        print("\n正在停止开发服务...", flush=True)
        return 0
    except RuntimeError as error:
        print(f"启动失败：{error}", file=sys.stderr, flush=True)
        return 1
    finally:
        stop_process(process)


if __name__ == "__main__":
    raise SystemExit(main())
