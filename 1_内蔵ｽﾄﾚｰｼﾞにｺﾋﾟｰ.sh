#!/data/data/com.termux/files/usr/bin/bash
if [ "$(id -u)" != "0" ]; then su -c "/data/data/com.termux/files/usr/bin/bash '$0'"; exit $?; fi

echo "====================================================="
echo "[Anti-Gravity] 証隔保全（全自動コピー） V10"
echo "====================================================="

echo "USBカードリーダー（SDカード等）を探しています..."
TARGET_DIR=$(ls /mnt/media_rw/ 2>/dev/null | grep -v "^$" | head -n 1)

if [ -z "$TARGET_DIR" ]; then
    echo "【エラー】カードリーダーが見つかりません。"
    sleep 5
    exit 1
fi

# 【修正箇所】fuse（ゴースト）を除外して本物のブロックデバイスを確実に取得する
MOUNTED_BLOCK=$(grep "/mnt/media_rw/$TARGET_DIR" /proc/mounts | grep -v "fuse" | grep -v "tmpfs" | awk '{print $1}' | head -n 1)

if [ -z "$MOUNTED_BLOCK" ]; then
    echo "【エラー】物理デバイスの特定に失敗しました！"
    sleep 5
    exit 1
fi

# sysfsを辿り、物理ドライブの根本（例: sda1ではなくsda）を特定する
if [[ "$MOUNTED_BLOCK" == *vold* ]]; then
    MAJOR_MINOR=$(basename "$MOUNTED_BLOCK" | cut -d':' -f2)
    SYSFS_ID=$(echo "$MAJOR_MINOR" | tr ',' ':')
    PART_PATH=$(readlink -f "/sys/dev/block/$SYSFS_ID")
else
    DEV_NAME=$(basename "$MOUNTED_BLOCK")
    PART_PATH=$(readlink -f "/sys/class/block/$DEV_NAME")
fi

if [ -f "$PART_PATH/partition" ]; then
    BASE_DEVICE_NAME=$(basename $(dirname "$PART_PATH"))
else
    BASE_DEVICE_NAME=$(basename "$PART_PATH")
fi

BLOCK_DEVICE="/dev/block/$BASE_DEVICE_NAME"

if [ ! -b "$BLOCK_DEVICE" ]; then
    echo "【エラー】本物の物理ドライブ ($BLOCK_DEVICE) にアクセスできません。"
    sleep 5
    exit 1
fi

SECTORS=$(cat /sys/class/block/$BASE_DEVICE_NAME/size 2>/dev/null || echo 0)
SIZE_GB=$((SECTORS * 512 / 1000 / 1000 / 1000))

if [ "$SIZE_GB" -eq 0 ]; then
    echo "【警告】容量の取得に失敗しました。デフォルト容量(32GB)と仮定します。"
    SIZE_GB=32
fi

# スマートネーミング機能
MOUNT_POINT="/mnt/media_rw/$TARGET_DIR"
DATA_TYPE="防犯カメラ"

echo "スマートネーミング解析中..."

# SDカード内の .dat ファイルを探して最古と最新の時間を特定する
OLDEST_FILE=$(find "$MOUNT_POINT" -type f -name "*.dat" 2>/dev/null | sort | head -n 1)
NEWEST_FILE=$(find "$MOUNT_POINT" -type f -name "*.dat" 2>/dev/null | sort | tail -n 1)

OLDEST_YYMMDD_HHMM=""
NEWEST_YYMMDD_HHMM=""

if [ -n "$OLDEST_FILE" ] && [ -n "$NEWEST_FILE" ]; then
    OLDEST_BASE=$(basename "$OLDEST_FILE")
    NEWEST_BASE=$(basename "$NEWEST_FILE")
    
    # ファイル名形式: YYYYMMDD_HHMMSS_*.dat を解析 (例: 20250903_032839_G2.dat)
    if [[ "$OLDEST_BASE" =~ ^[0-9]{8}_[0-9]{6}_.*\.dat$ ]]; then
        # 西暦下2桁(25) + 月日(0903) + ハイフン + 時分(0328)
        OLDEST_YYMMDD_HHMM="${OLDEST_BASE:2:6}-${OLDEST_BASE:9:4}"
    fi
    
    if [[ "$NEWEST_BASE" =~ ^[0-9]{8}_[0-9]{6}_.*\.dat$ ]]; then
        NEWEST_YYMMDD_HHMM="${NEWEST_BASE:2:6}-${NEWEST_BASE:9:4}"
    fi
fi

if [ -n "$OLDEST_YYMMDD_HHMM" ] && [ -n "$NEWEST_YYMMDD_HHMM" ]; then
    echo "最古データ: 20${OLDEST_YYMMDD_HHMM:0:2}年${OLDEST_YYMMDD_HHMM:2:2}月${OLDEST_YYMMDD_HHMM:4:2}日 ${OLDEST_YYMMDD_HHMM:7:2}時${OLDEST_YYMMDD_HHMM:9:2}分"
    echo "最新データ: 20${NEWEST_YYMMDD_HHMM:0:2}年${NEWEST_YYMMDD_HHMM:2:2}月${NEWEST_YYMMDD_HHMM:4:2}日 ${NEWEST_YYMMDD_HHMM:7:2}時${NEWEST_YYMMDD_HHMM:9:2}分"
    DEFAULT_NAME="${DATA_TYPE}_${OLDEST_YYMMDD_HHMM}_${NEWEST_YYMMDD_HHMM}"
else
    echo "【警告】録画データの解析に失敗しました。デフォルトの日付名を使用します。"
    DEFAULT_NAME="${DATA_TYPE}_${SIZE_GB}GB_$(date +"%y%m%d_%H%M")"
fi

echo "-----------------------------------------------------"
echo "【AIスマートネーミング】"
echo "保存するフォルダ名: $DEFAULT_NAME"
echo "-----------------------------------------------------"
printf "この名前で保存しますか？ (そのままEnterで決定 / 変更する場合は入力) > "
read USER_INPUT

if [ -n "$USER_INPUT" ]; then
    FINAL_NAME="$USER_INPUT"
else
    FINAL_NAME="$DEFAULT_NAME"
fi

DEST_DIR="/data/media/0/Download/$FINAL_NAME"
mkdir -p "$DEST_DIR"
chown -R media_rw:media_rw "$DEST_DIR" 2>/dev/null

FILENAME="raw_dump.bin"

echo ""
echo "保存先: /Download/$FINAL_NAME"
echo "物理ディスク全体 ($BLOCK_DEVICE) を抽出します"
echo "吸い上げを開始します...（32GBなら約10〜15分かかります）"

dd if="$BLOCK_DEVICE" of="$DEST_DIR/$FILENAME" bs=4M > /data/local/tmp/dd_error.log 2>&1 &
DD_PID=$!

spin='-\|/'
i=0
while kill -0 $DD_PID 2>/dev/null; do
  i=$(( (i+1) %4 ))
  printf "\r吸い上げ中... %c" "${spin:$i:1}"
  sleep 0.5
done

echo ""
echo "====================================================="
if grep -q -i "error\|No space\|Read-only\|denied\|invalid" /data/local/tmp/dd_error.log 2>/dev/null; then
    echo "【重大エラー】コピー中に問題が発生しました！"
    cat /data/local/tmp/dd_error.log
else
    FILE_SIZE=$(ls -lh "$DEST_DIR/$FILENAME" | awk '{print $5}')
    echo "【完了】全データの完全コピー（保全）に成功しました！"
    echo "最終ファイルサイズ: $FILE_SIZE"
    echo "【重要】安全にUSBカードリーダーを抜いてOKです。"
fi
echo "====================================================="
cmd vibrator vibrate 1000 2>/dev/null
echo ""
read -p "処理が完了しました。Enterキーを押すと画面を閉じます..."
