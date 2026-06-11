#!/usr/bin/env python3
import os
import subprocess
import shutil

# ==========================================================
# iMac環境大掃除 ＆ Pixel自動同期スクリプト (一撃実行版)
# ==========================================================

# 1. パスの設定
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ANDROID_DEST_DIR = "/sdcard/Download/project_anti/"

# iMac側の管理名と、Pixel側の実体名（起動用）のマッピング
# 厳格な転送仕様：ローカルの 01_ などのプレフィックスや日本語名を吸収し、
# 転送先では必ず元の実行可能な英語ファイル名で上書きする
TRANSFER_MAP = {
    "01_cam_server.py": "android_server.py"
}

# 転送するビューアーのWEB画面ファイルリスト
VIEWER_FILES = [
    "viewer/index.html",
    "viewer/app.js",
    "viewer/style.css",
    "viewer/manifest.json",
    "viewer/sw.js"
]

# 削除するゴミファイルリスト（iMac側）
GARBAGE_FILES = [
    "desktop_app.py",
    "server.py",
    "extract_videos.py",
    "extract_only_gps.py"
]

def print_separator():
    print("=" * 60)

def main():
    print_separator()
    print("🚗 [自動同期防犯カメラ] 運行を開始します...")
    print_separator()

    # --- Step 1: iMac側のゴミ掃除 (車内清掃) ---
    print("🧹 [車内清掃] iMac側の不要なゴミファイルをお掃除します...")
    cleaned_count = 0
    for garbage in GARBAGE_FILES:
        garbage_path = os.path.join(BASE_DIR, garbage)
        if os.path.exists(garbage_path):
            try:
                os.remove(garbage_path)
                print(f"  -> 消去成功: {garbage}")
                cleaned_count += 1
            except Exception as e:
                print(f"  [!] 消去失敗: {garbage} (原因: {e})")
        else:
            # すでに消去済みの場合はスキップ
            pass
            
    if cleaned_count > 0:
        print(f"✨ iMac側のゴミ掃除が完了しました（{cleaned_count}個のファイルを削除）。")
    else:
        print("✨ すでにiMac側はきれいな状態です。")

    print_separator()

    # --- Step 2: Pixel接続確認 (行き先の道路状況チェック) ---
    print("📱 [接続確認] 物理接続されたPixelスマホを探しています...")
    
    # adbコマンドが存在するかチェック
    adb_path = shutil.which("adb")
    if not adb_path:
        print("[⚠️ エラー] Macに 'adb' コマンドが見つかりません。")
        print("Android開発環境（Platform-tools）がインストールされているかご確認ください。")
        return
 
    # 接続デバイスリストの取得
    try:
        result = subprocess.run([adb_path, "devices"], capture_output=True, text=True, check=True)
        lines = result.stdout.strip().split("\n")
        devices = [line.split("\t")[0] for line in lines[1:] if "\tdevice" in line]
    except Exception as e:
        print(f"[⚠️ エラー] デバイスリストの取得に失敗しました: {e}")
        return

    if not devices:
        print("[⚠️ エラー] PixelスマホがMacに認識されていません。")
        print("  - USBケーブルが正しく接続されているか")
        print("  - スマホ側で『USBデバッグ』が許可されているか")
        print("上記をご確認の上、もう一度実行してください。")
        return

    pixel_id = devices[0]
    print(f"✅ Pixelスマホを検出しました (ID: {pixel_id})。")

    print_separator()

    # A. システム本体の転送
    for local_name, pixel_name in TRANSFER_MAP.items():
        local_path = os.path.join(BASE_DIR, local_name)
        android_path = ANDROID_DEST_DIR + pixel_name
        
        if not os.path.exists(local_path):
            print(f"[⚠️ エラー] 転送元となる iMac側の {local_name} が見つかりません。")
            continue

        print(f"📤 [転送中] {local_name} を Pixelスマホへ {pixel_name} として送り届けています...")
        try:
            subprocess.run(
                [adb_path, "push", local_path, android_path],
                capture_output=True,
                text=True,
                check=True
            )
            print(f"✅ {pixel_name} の転送に成功しました。")
        except subprocess.CalledProcessError as e:
            print(f"[⚠️ エラー] {local_name} の転送に失敗しました。")
            print(f"エラー詳細:\n{e.stderr}")

    # B. WEBデザインファイル群の転送
    print("📤 [転送中] 最新のビューアーデザイン画面を送り届けています...")
    success_files = 0
    for file_rel in VIEWER_FILES:
        local_file_path = os.path.join(BASE_DIR, file_rel)
        if os.path.exists(local_file_path):
            android_file_path = ANDROID_DEST_DIR + file_rel
            try:
                # 転送先のサブフォルダを作成 (念のため)
                android_dir_path = ANDROID_DEST_DIR + os.path.dirname(file_rel)
                subprocess.run(
                    [adb_path, "shell", f"mkdir -p {android_dir_path}"],
                    capture_output=True,
                    check=True
                )
                # ファイルをプッシュ
                subprocess.run(
                    [adb_path, "push", local_file_path, android_file_path],
                    capture_output=True,
                    check=True
                )
                print(f"  -> 送信成功: {file_rel}")
                success_files += 1
            except Exception as e:
                print(f"  [!] 送信失敗: {file_rel} (原因: {e})")
        else:
            print(f"  [!] ファイルが存在しません: {file_rel}")

    print(f"✅ デザイン画面の転送が完了しました（{success_files}/{len(VIEWER_FILES)} ファイル）。")

    print_separator()
    print("🎉 [運行完了] すべてのクリーンアップと同期が正常に完了しました！")
    print_separator()

if __name__ == "__main__":
    main()
