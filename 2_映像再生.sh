#!/data/data/com.termux/files/usr/bin/bash

echo "====================================================="
echo "[Anti-Gravity] CAM 映像再生"
echo "====================================================="

# 全Pythonサーバーをリセット（前回の残骸を掃除）
su -c 'pkill -9 -f python' 2>/dev/null
sleep 1

# 【証拠隠滅】起動のたびに前回のキャッシュ（再生履歴MP4）を全消去してクリーンにする
su -c 'rm -rf /sdcard/Download/project_anti/viewer/cache/* 2>/dev/null'

# サーバーを起動（root権限・ポート8002固定）
# ※WebAPKが http://localhost:8002 にバインドされているため、必ず8002で起動する
echo "サーバーを起動しています..."
su -c 'cd /sdcard/Download/project_anti && export PATH=/data/data/com.termux/files/usr/bin:$PATH && nohup python android_server.py > /dev/null 2>&1 &'
sleep 3

# 横画面・フルスクリーン（URLバーなし）のWebAPKを起動
echo "datメディアプレイヤーを起動します..."
am start -n org.chromium.webapk.ad1bb52632754828a_v2/org.chromium.webapk.shell_apk.h2o.H2OMainActivity

echo "起動完了"
