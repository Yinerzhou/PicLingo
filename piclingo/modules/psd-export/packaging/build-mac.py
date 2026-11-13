"""【待 Mac 实机验证】原生构建两个后端及 Electron DMG/ZIP，签名可选。"""
import argparse
import hashlib
import json
import os
import platform
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path
from models import ensure_models

WORKSPACE = Path(__file__).resolve().parents[3]
MODULE = WORKSPACE / "modules/psd-export"


def run(arguments, **options):
    try:
        subprocess.run([str(value) for value in arguments], check=True, **options)
    except subprocess.CalledProcessError as error:
        output = options.get("stdout")
        if hasattr(output, "name"):
            output.flush()
            print(Path(output.name).read_text(encoding="utf-8", errors="replace")[-12000:])
        # 公证命令包含应用专用密码，异常中仅输出步骤和退出码。
        raise RuntimeError("%s 步骤失败，退出码 %s" % (Path(str(arguments[0])).name, error.returncode)) from None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--arch", required=True, choices=["arm64", "x64"])
    parser.add_argument("--signed", action="store_true")
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise RuntimeError("Mac 后端及 DMG 需要在 macOS 原生构建")
    actual = {"arm64": "arm64", "x86_64": "x64"}.get(platform.machine())
    if actual != args.arch or sys.version_info[:2] != (3, 11):
        raise RuntimeError("请使用目标架构的 Python 3.11，当前 %s / %s" % (platform.machine(), sys.version))
    if args.signed and not (os.environ.get("CSC_LINK") and os.environ.get("CSC_KEY_PASSWORD")):
        raise RuntimeError("签名构建需要 CSC_LINK 与 CSC_KEY_PASSWORD")
    if args.signed and not (os.environ.get("APPLE_ID") and os.environ.get("APPLE_APP_SPECIFIC_PASSWORD") and os.environ.get("APPLE_TEAM_ID")):
        raise RuntimeError("公证需要 APPLE_ID、APPLE_APP_SPECIFIC_PASSWORD、APPLE_TEAM_ID")
    build = MODULE / "release" / ("mac-" + args.arch)
    build.mkdir(parents=True, exist_ok=True)
    entitlements = build / "entitlements.mac.plist"
    with (MODULE / "packaging/entitlements.mac.plist").open("rb") as source:
        entitlements_value = plistlib.load(source)
    # 统一输出原生 XML 格式与 LF，供 AMFI 的权限解析器读取。
    with entitlements.open("wb") as output_file:
        plistlib.dump(entitlements_value, output_file)
    run(["plutil", "-lint", entitlements])
    environment = build / "venv"
    if not environment.exists():
        run([sys.executable, "-m", "venv", environment])
    python = environment / "bin/python"
    run([python, "-m", "pip", "install", "-r", MODULE / "packaging/requirements-mac.txt"])
    ensure_models(WORKSPACE)
    # 原有图片引擎及规格文件直接复用，保持图像处理算法原样。
    run([python, "-m", "PyInstaller", "--noconfirm", "--distpath", build / "ocr-dist", "--workpath", build / "ocr-work", WORKSPACE / "work/PicLingoWorker.spec"])
    run([python, "-m", "PyInstaller", "--noconfirm", "--distpath", build / "psd-dist", "--workpath", build / "psd-work", MODULE / "packaging/psd.spec"])
    probe = build / "psd-workbook-probe"
    probe.mkdir(exist_ok=True)
    probe_request = {"operation": "workbook", "excel": str(MODULE / "samples/测试 样本/翻译 模板.xlsx")}
    (probe / "request.json").write_text(json.dumps(probe_request, ensure_ascii=False), encoding="utf-8")
    probe_environment = os.environ.copy()
    probe_environment["PICLINGO_PSD_HOME"] = str(build / "psd-state")
    with (probe / "console.log").open("w") as log:
        run([build / "psd-dist/PicLingoPSD/PicLingoPSD", "--request", probe / "request.json", "--job", probe],
            env=probe_environment, stdout=log, stderr=subprocess.STDOUT, timeout=60)
    probe_result = json.loads((probe / "response.json").read_text(encoding="utf-8"))
    if not probe_result["ok"] or len(probe_result["result"]["languages"]) != 3:
        raise RuntimeError("Mac PSD 引擎 Excel 读取未通过")
    project = build / "electron"
    project.mkdir(exist_ok=True)
    ui = WORKSPACE / "outputs/PicLingo-Liquid-Glass"
    app_dir = project / "app"
    app_dir.mkdir(exist_ok=True)
    for name in ["index.html", "styles.css", "app.js", "desktop-bridge.js", "package.json", "package-lock.json"]:
        shutil.copy2(ui / name, app_dir / name)
    for name in ["assets", "electron", "modules", "tests"]:
        shutil.copytree(ui / name, app_dir / name, dirs_exist_ok=True)
    shutil.copy2(MODULE / "packaging/package.json", project / "package.json")
    shutil.copy2(MODULE / "packaging/package-lock.json", project / "package-lock.json")
    run(["npm", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=app_dir)
    output = WORKSPACE / "outputs" / ("mac-" + args.arch)
    config = {
        "appId": "com.piclingo.desktop", "productName": "PicLingo", "asar": True, "forceCodeSigning": args.signed,
        "directories": {"app": str(app_dir), "output": str(output)},
        "files": ["**/*", "!tests/**"],
        "afterPack": str(MODULE / "packaging/after-pack.cjs"),
        "extraResources": [
            {"from": str(build / "ocr-dist/PicLingoWorker"), "to": "backend"},
            {"from": str(build / "psd-dist/PicLingoPSD"), "to": "psd"},
            {"from": str(WORKSPACE / "work/licenses"), "to": "licenses"},
            {"from": str(MODULE / "packaging/licenses"), "to": "licenses/psd"},
            {"from": str(WORKSPACE / "work/THIRD-PARTY-NOTICES.md"), "to": "THIRD-PARTY-NOTICES.md"}
        ],
        "mac": {
            "target": ["dmg", "zip"], "minimumSystemVersion": "13.0.0",
            "category": "public.app-category.graphics-design", "icon": str(MODULE / "packaging/app.icns"),
            "hardenedRuntime": True, "gatekeeperAssess": False,
            "entitlements": str(entitlements),
            "entitlementsInherit": str(entitlements),
            "extendInfo": {"NSAppleEventsUsageDescription": "使用 Photoshop 读取 PSD 文字图层，并根据 Excel 译文导出多语言图片。"},
            "binaries": ["Contents/Resources/backend/PicLingoWorker", "Contents/Resources/psd/PicLingoPSD"],
            "notarize": args.signed,
            "artifactName": "PicLingo-${version}-${arch}.${ext}"
        },
        "dmg": {"writeUpdateInfo": False},
        "publish": [{"provider": "generic", "url": os.environ.get("PICLINGO_UPDATE_URL", "https://updates.example.com/piclingo/mac-" + args.arch + "/")}]
    }
    if not args.signed:
        config["mac"]["identity"] = "-"
    (project / "electron-builder.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    run(["npm", "ci", "--no-audit", "--no-fund"], cwd=project)
    builder_environment = os.environ.copy()
    if not args.signed:
        for key in ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]:
            builder_environment.pop(key, None)
        builder_environment["CSC_IDENTITY_AUTO_DISCOVERY"] = "false"
    run([project / "node_modules/.bin/electron-builder", "--config", "electron-builder.json", "--mac", "--" + args.arch, "--publish", "never"], cwd=project, env=builder_environment)
    app_bundle = output / ("mac-arm64" if args.arch == "arm64" else "mac") / "PicLingo.app"
    run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", app_bundle])
    if args.signed:
        run(["spctl", "--assess", "--type", "execute", "--verbose=2", app_bundle])
    # 在独立验收副本启用检查入口，正式产物继续保留生产限制。
    qa_bundle = build / "qa/PicLingo.app"
    shutil.copytree(app_bundle, qa_bundle, dirs_exist_ok=True)
    (qa_bundle / "Contents/Resources/piclingo-test-build.json").write_text("{}", encoding="utf-8")
    run(["codesign", "--force", "--deep", "--sign", "-", "--options", "runtime", "--entitlements", entitlements, qa_bundle])
    smoke = build / "smoke/result.json"
    smoke.parent.mkdir(exist_ok=True)
    with (build / "smoke/console.log").open("w") as log:
        run([qa_bundle / "Contents/MacOS/PicLingo", "--app-smoke=" + str(smoke)], stdout=log, stderr=subprocess.STDOUT, timeout=300)
    result = json.loads(smoke.read_text(encoding="utf-8"))
    if not result["workflow"]["editedImageChanged"]:
        raise RuntimeError("Mac 原有图片翻译回归未通过")
    for artifact in output.iterdir():
        if artifact.suffix not in (".dmg", ".zip"):
            continue
        if args.signed and artifact.suffix == ".dmg":
            run(["xcrun", "notarytool", "submit", artifact, "--apple-id", os.environ["APPLE_ID"],
                 "--password", os.environ["APPLE_APP_SPECIFIC_PASSWORD"], "--team-id", os.environ["APPLE_TEAM_ID"], "--wait"])
            run(["xcrun", "stapler", "staple", artifact])
            run(["xcrun", "stapler", "validate", artifact])
        with artifact.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        artifact.with_name(artifact.name + ".sha256.txt").write_text(digest + "  " + artifact.name + "\n", encoding="utf-8")
    print("MAC_BUILD_COMPLETE " + str(output))


if __name__ == "__main__":
    main()

