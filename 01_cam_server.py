import http.server
import socketserver
import os
import json
import urllib.parse
import subprocess
import shutil
import re
import struct

# ==========================================================
# 【Stage 5】Android専用バックエンドエンジン V5.0 (最強音声クリーン化・安全装置付き)
# 修正: タイムスタンプ時差自動補正、昼夜シフト完全分離、フレーム精確切り落とし
#       + 最強音声フィルター（ハイパス + AI雑音除去 + 音声帯域EQ + 音量正規化）
#       + FFmpegの arnndn フィルター有無に応じた自動フォールバック安全装置
# ==========================================================

PORT = 8002
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VIEWER_DIR = os.path.join(BASE_DIR, "viewer")
CACHE_DIR = os.path.join(VIEWER_DIR, "cache")
TEST_DATA_DIR = os.path.join(BASE_DIR, "防犯カメラ")
RAW_SOURCE_FILE = None
VIRTUAL_INDEX = []

if not os.path.exists(VIEWER_DIR):
    os.makedirs(VIEWER_DIR)
if not os.path.exists(CACHE_DIR):
    os.makedirs(CACHE_DIR)

FFMPEG_PATH = shutil.which("ffmpeg") or "/data/data/com.termux/files/usr/bin/ffmpeg"

_has_arnndn = None

def get_audio_filter():
    """FFmpegの対応フィルター状況をスキャンし、最適な音声クリア用フィルターを返す（自動安全装置）"""
    global _has_arnndn
    if _has_arnndn is None:
        try:
            r = subprocess.run([FFMPEG_PATH, '-filters'], capture_output=True, text=True)
            _has_arnndn = (r.returncode == 0 and "arnndn" in r.stdout)
        except Exception:
            _has_arnndn = False
            
    rnnn_model = os.path.join(BASE_DIR, "tools", "mp.rnnn")
    
    # 1. AI雑音除去 (arnndn) が利用可能で、モデルファイルも存在する場合 (最強セット5)
    if _has_arnndn and os.path.exists(rnnn_model):
        print(f"[Filter] AI雑音除去 (arnndn) を適用します。モデル: {rnnn_model}")
        return f"highpass=f=200,arnndn=m='{rnnn_model}',equalizer=f=1000:t=o:w=1500:g=5,dynaudnorm=p=0.9:m=30"
    
    # 2. arnndnは使えないが、anlmdn (非AIの高性能ノイズ除去) が使える場合のフォールバック
    try:
        r = subprocess.run([FFMPEG_PATH, '-filters'], capture_output=True, text=True)
        has_anlmdn = (r.returncode == 0 and "anlmdn" in r.stdout)
    except Exception:
        has_anlmdn = False
        
    if has_anlmdn:
        print("[Filter] AIノイズキャンセラー非対応のため、高性能ノイズ低減 (anlmdn) にフォールバックします。")
        return "highpass=f=200,anlmdn,equalizer=f=1000:t=o:w=1500:g=5,dynaudnorm=p=0.9:m=30"
    
    # 3. どちらも使えない場合、基本フィルターで安全に処理
    print("[Filter] 音声フィルター非対応のため、ハイパス + イコライザー + 音量正規化を適用します。")
    return "highpass=f=200,equalizer=f=1000:t=o:w=1500:g=5,dynaudnorm=p=0.9:m=30"


def build_virtual_index(file_path):
    global VIRTUAL_INDEX
    print(f"[Engine] 巨大テープのレントゲンスキャンを開始: {file_path}")
    print(f"[Engine] ※約30秒〜1分かかります。少々お待ちください...")
    virtual_index = []
    try:
        with open(file_path, "rb") as f:
            pos = 0
            count = 0
            while True:
                f.seek(pos)
                head = f.read(4)
                if not head: break
                
                if head != b"RIFF":
                    data = f.read(1024 * 1024)
                    if not data: break
                    idx = data.find(b"RIFF")
                    if idx != -1:
                        pos += 4 + idx
                        continue
                    else:
                        pos += 1024 * 1024
                        continue
                        
                size_data = f.read(4)
                if len(size_data) < 4: break
                size = struct.unpack("<I", size_data)[0]
                total_chunk_size = size + 8
                
                f.seek(pos)
                sample = f.read(min(total_chunk_size, 1024 * 1024 * 2))
                name = f"chunk_{count:04d}.dat"
                if b'$GPRMC,' in sample:
                     try:
                         import datetime
                         gprmc_idx = sample.find(b'$GPRMC,')
                         gprmc_line = sample[gprmc_idx:sample.find(b'\n', gprmc_idx)]
                         parts = gprmc_line.split(b',')
                         if len(parts) >= 10 and parts[2] == b'A':
                             utc_time = parts[1].split(b'.')[0].decode()
                             utc_date = parts[9].decode()
                             if len(utc_time) >= 6 and len(utc_date) == 6:
                                 dt_utc = datetime.datetime.strptime(f"{utc_date} {utc_time}", "%d%m%y %H%M%S")
                                 dt_jst = dt_utc + datetime.timedelta(hours=9)
                                 name = dt_jst.strftime(f"%Y%m%d_%H%M%S_{count:04d}.dat")
                     except Exception:
                         pass
                     
                virtual_index.append({"name": name, "offset": pos, "size": total_chunk_size})
                pos += total_chunk_size
                count += 1
                if count % 100 == 0:
                     print(f"  ... {count} ファイル検出 ...")
                     
        print(f"[Engine] スキャン完了！ 合計 {len(virtual_index)} 個 of 映像チャンクを発見しました。")
        VIRTUAL_INDEX = virtual_index
    except Exception as e:
        print(f"[Engine] スキャンエラー: {e}")
        VIRTUAL_INDEX = []

def get_virtual_file_path(filename):
    if not RAW_SOURCE_FILE:
        return os.path.join(TEST_DATA_DIR, filename)
    
    file_path = os.path.join(CACHE_DIR, filename)
    if os.path.exists(file_path):
        return file_path
        
    print(f"[Engine] 仮想ファイルのオンデマンド抽出を実行: {filename}")
    item = next((x for x in VIRTUAL_INDEX if x["name"] == filename), None)
    if not item: return None
    
    try:
        with open(RAW_SOURCE_FILE, "rb") as fin:
            fin.seek(item["offset"])
            chunk = fin.read(item["size"])
        with open(file_path, "wb") as fout:
            fout.write(chunk)
        return file_path
    except Exception as e:
        print(f"[Engine] 抽出エラー: {e}")
        return None

class AndroidServerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=VIEWER_DIR, **kwargs)
        
    extensions_map = http.server.SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map.update({
        '.json': 'application/manifest+json',
        '.js': 'application/javascript',
        '.svg': 'image/svg+xml'
    })

    def end_headers(self):
        # 3. CORS対策：すべて許可(*)を廃止し、localhost（安全なアクセス）のみを許可
        origin = self.headers.get('Origin')
        if origin in ['http://localhost:8002', 'http://127.0.0.1:8002']:
            self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        
        if parsed_path.path == "/api/list_dirs":
            self.handle_list_dirs(parsed_path)
            return
            
        if parsed_path.path == "/api/videos":
            self.handle_api_videos()
            return
            
        if parsed_path.path == "/api/telemetry":
            self.handle_telemetry(parsed_path)
            return
        
        if parsed_path.path.startswith("/stream/"):
            self.handle_stream(parsed_path)
            return
            
        if parsed_path.path.startswith("/cache/") and parsed_path.path.endswith(".mp4"):
            self.handle_video_range(parsed_path.path)
            return
            
        super().do_GET()

    def do_POST(self):
        parsed_path = urllib.parse.urlparse(self.path)
        
        if parsed_path.path == "/api/export_merged":
            self.handle_export_merged()
            return
            
        if parsed_path.path == "/api/set_folder":
            self.handle_set_folder()
            return
            
        if parsed_path.path == "/api/extract_by_time":
            self.handle_extract_by_time()
            return
            
        self.send_error(404, "Not Found")

    def handle_video_range(self, path):
        # /cache/filename.mp4 を配信する際、ブラウザのシーク要求(Range)に完全応答する
        # 2. ディレクトリトラバーサル対策：リクエストパスから純粋なファイル名のみを抽出
        safe_filename = os.path.basename(path.lstrip('/'))
        file_path = os.path.join(VIEWER_DIR, 'cache', safe_filename)
        if not os.path.exists(file_path):
            self.send_error(404, "File not found")
            return

        file_size = os.path.getsize(file_path)
        range_header = self.headers.get('Range')

        if range_header:
            byte_range = range_header.replace('bytes=', '').split('-')
            start = int(byte_range[0])
            end = int(byte_range[1]) if byte_range[1] else file_size - 1

            length = end - start + 1
            self.send_response(206) # Partial Content
            self.send_header('Content-type', 'video/mp4')
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
            self.send_header('Content-Length', str(length))
            self.end_headers()

            with open(file_path, 'rb') as f:
                f.seek(start)
                # メモリ爆発を防ぐためチャンクで送信
                chunk_size = 1024 * 1024
                bytes_sent = 0
                while bytes_sent < length:
                    chunk = f.read(min(chunk_size, length - bytes_sent))
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                    except BrokenPipeError:
                        break
                    bytes_sent += len(chunk)
        else:
            self.send_response(200)
            self.send_header('Content-type', 'video/mp4')
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(file_size))
            self.end_headers()
            with open(file_path, 'rb') as f:
                shutil.copyfileobj(f, self.wfile)


    def handle_list_dirs(self, parsed_path):
        query = urllib.parse.parse_qs(parsed_path.query)
        target_path = query.get('path', [''])[0]
        
        # パスが空の場合はルート候補を設定
        if not target_path:
            if os.path.exists('/storage/emulated/0'):
                target_path = '/storage/emulated/0' # AndroidのSDカードや内部ストレージのルート
            else:
                target_path = os.path.expanduser('~') # Macの場合はホームディレクトリ
                
        if not os.path.exists(target_path) and not target_path.startswith('/dev/'):
            self.send_error(404, "Path not found")
            return
            
        try:
            items = []
            if os.path.isfile(target_path) or target_path.startswith('/dev/'):
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"current_path": target_path, "items": []}).encode())
                return
                
            # 親ディレクトリへのパス
            parent_path = os.path.dirname(target_path)
            if parent_path and parent_path != target_path:
                items.append({"name": ".. (上の階層へ)", "path": parent_path, "is_dir": True})
                
            for f in os.listdir(target_path):
                full_path = os.path.join(target_path, f)
                if f.startswith('.'): continue
                if os.path.isdir(full_path):
                    items.append({"name": f, "path": full_path, "is_dir": True})
                elif f.endswith('.dmg') or f.endswith('.img') or f.endswith('.iso'):
                    items.append({"name": f, "path": full_path, "is_dir": False})
                    
            # 名前順にソート（".."は先頭のまま維持したいが、ここでは単純にすべてソートする）
            items.sort(key=lambda x: x["name"].lower() if not x["name"].startswith('..') else '')
            
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"current_path": target_path, "items": items}).encode())
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def handle_set_folder(self):
        global TEST_DATA_DIR, RAW_SOURCE_FILE
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error(400, "Bad Request")
                return
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)
            
            target_path = data.get('path', '')
            if os.path.exists(target_path) or target_path.startswith('/dev/'):
                if os.path.isfile(target_path) or target_path.startswith('/dev/'):
                    TEST_DATA_DIR = os.path.dirname(target_path) if not target_path.startswith('/dev/') else '/dev'
                    RAW_SOURCE_FILE = target_path
                    build_virtual_index(RAW_SOURCE_FILE)
                else:
                    TEST_DATA_DIR = target_path
                    potential_raw = os.path.join(target_path, "raw_dump.bin")
                    parent_raw = os.path.join(os.path.dirname(target_path), "raw_dump.bin")
                    
                    if os.path.exists(potential_raw):
                        RAW_SOURCE_FILE = potential_raw
                        build_virtual_index(RAW_SOURCE_FILE)
                    elif os.path.exists(parent_raw):
                        RAW_SOURCE_FILE = parent_raw
                        build_virtual_index(RAW_SOURCE_FILE)
                    else:
                        RAW_SOURCE_FILE = None
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "path": target_path}).encode())
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Invalid path", "path": target_path}).encode())
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())

    def handle_extract_by_time(self):
        global TEST_DATA_DIR, RAW_SOURCE_FILE, VIRTUAL_INDEX
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error(400, "Bad Request")
                return
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)
            
            raw_path = data.get('raw_path', '')
            
            # 【絶対ルール】root権限でのFUSEブロック（Errno 13）を回避するため、
            # 仮想パス（/storage/emulated/0）を物理パス（/data/media/0）に強制変換する
            if raw_path.startswith('/storage/emulated/0'):
                raw_path = raw_path.replace('/storage/emulated/0', '/data/media/0', 1)

            if os.path.isdir(raw_path):
                # Check current directory
                potential = os.path.join(raw_path, "raw_dump.bin")
                # Fallback to parent directory if they are inside a subfolder
                parent_potential = os.path.join(os.path.dirname(raw_path), "raw_dump.bin")
                
                if os.path.exists(potential):
                    raw_path = potential
                elif os.path.exists(parent_potential):
                    raw_path = parent_potential
                else:
                    raw_path = potential
                
            start_time = data.get('start_time', '') # e.g. '20260527_230000'
            end_time = data.get('end_time', '')     # e.g. '20260528_010000'
            
            if not os.path.exists(raw_path):
                self.send_response(400)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": f"塊データ(raw_dump.bin)が見つかりません。上の階層を選んでください。"}).encode())
                return
                
            # 出力先ディレクトリの設定とクリーンアップ
            output_dir = os.path.join(os.path.dirname(raw_path), "Evidenced_Videos")
            if not os.path.exists(output_dir):
                os.makedirs(output_dir)
            else:
                for f in os.listdir(output_dir):
                    if f.endswith(".dat") or f.endswith(".mp4") or f.endswith(".json"):
                        os.remove(os.path.join(output_dir, f))
                        
            # RAWファイルが変わっていればインデックスを構築
            if RAW_SOURCE_FILE != raw_path or not VIRTUAL_INDEX:
                RAW_SOURCE_FILE = raw_path
                build_virtual_index(raw_path)
                
            # 時間フィルタリングと抽出
            extracted_count = 0
            for item in VIRTUAL_INDEX:
                name = item["name"]
                # チャンク名は 'YYYYMMDD_HHMMSS_XXXX.dat'
                name_time = name[:15].replace('_', '')
                if name_time >= start_time and name_time <= end_time:
                    try:
                        out_path = os.path.join(output_dir, name)
                        with open(raw_path, "rb") as fin:
                            fin.seek(item["offset"])
                            chunk = fin.read(item["size"])
                        with open(out_path, "wb") as fout:
                            fout.write(chunk)
                        extracted_count += 1
                    except Exception as e:
                        print(f"[Extract] エラー: {name} - {e}")
                        
            # 抽出完了後、読み込み先を切り替える
            TEST_DATA_DIR = output_dir
            RAW_SOURCE_FILE = None # RAWからの動的読み込みではなく、出力先からの読み込みに固定
            
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "extracted": extracted_count, "output_dir": output_dir}).encode())
            
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())

    def handle_api_videos(self):
        try:
            if RAW_SOURCE_FILE:
                files = [item['name'] for item in VIRTUAL_INDEX]
            else:
                files = [f for f in os.listdir(TEST_DATA_DIR) if f.endswith('.dat')]
            files.sort(reverse=True)
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"videos": files}).encode())
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def handle_telemetry(self, parsed_path):
        filename = urllib.parse.parse_qs(parsed_path.query).get('file', [''])[0]
        file_path = get_virtual_file_path(filename)
        
        if not file_path or not os.path.exists(file_path):
            self.send_error(404, "File not found")
            return
            
        telemetry_data = []
        try:
            with open(file_path, 'rb') as f:
                data = f.read()
            
            # $GPRMCパターン
            pattern = br'\$GPRMC,(\d{6})(?:\.\d+)?,A,([\d\.]+),N,([\d\.]+),E,([\d\.]+),'
            matches = re.finditer(pattern, data)
            
            # ファイル名から想定される運行シフトの「JST基準時間」を特定 (例: "20250903_032839" -> 3時)
            expected_hour = None
            if "_" in filename:
                time_part = filename.split("_")[1]
                if len(time_part) >= 2:
                    expected_hour = int(time_part[:2])
            
            start_time_sec = None
            for m in matches:
                utc_time = m.group(1).decode()
                lat = m.group(2).decode()
                lon = m.group(3).decode()
                knots = float(m.group(4).decode())
                kmh = int(knots * 1.852)
                
                h, m_min, s = int(utc_time[0:2]), int(utc_time[2:4]), int(utc_time[4:6])
                
                # UTC(世界標準時)をJST(日本時間)に変換 (+9時間時差補正)
                hh_jst = (h + 9) % 24
                
                # 【時系列チェック】GPSの記録時間が、ファイル名から想定されるシフト時間から離れすぎている場合は、
                # 昼勤など別のシフトのゴミデータとみなして完全に除外する
                if expected_hour is not None:
                    diff = min(abs(hh_jst - expected_hour), 24 - abs(hh_jst - expected_hour))
                    if diff > 1:
                        continue
                
                total_sec = h * 3600 + m_min * 60 + s
                
                if start_time_sec is None:
                    start_time_sec = total_sec
                    
                offset = total_sec - start_time_sec
                if offset < 0: offset += 86400
                
                jst_time = f"{hh_jst:02d}:{m_min:02d}:{s:02d}"
                
                telemetry_data.append({
                    "offset": offset,
                    "time": jst_time,
                    "speed": kmh,
                    "lat": lat,
                    "lon": lon
                })
        except Exception as e:
            pass

        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(telemetry_data).encode())


    def get_true_duration(self, file_path):
        try:
            with open(file_path, 'rb') as f:
                data = f.read()
            pattern = re.compile(b'\\$GPRMC,[^*]+\\*[0-9A-Fa-f]{2}')
            matches = list(pattern.finditer(data))
            if not matches:
                return None, None
                
            filename = os.path.basename(file_path)
            expected_hour = None
            if "_" in filename:
                time_part = filename.split("_")[1]
                if len(time_part) >= 2:
                    expected_hour = int(time_part[:2])
                    
            def to_sec(t_str):
                return int(t_str[0:2])*3600 + int(t_str[2:4])*60 + int(t_str[4:6])
                
            valid_matches = []
            for m in matches:
                m_bytes = m.group(0)
                parts = m_bytes.decode('ascii', errors='ignore').split(',')
                if len(parts) >= 10 and parts[2] == 'A':
                    t_str = parts[1][:6]
                    hh = int(t_str[0:2])
                    hh_jst = (hh + 9) % 24
                    
                    if expected_hour is not None:
                        diff = min(abs(hh_jst - expected_hour), 24 - abs(hh_jst - expected_hour))
                        if diff > 1:
                            continue
                    valid_matches.append((t_str, m.start()))
                    
            if not valid_matches:
                return None, None
                
            start_time = valid_matches[0][0]
            end_time = valid_matches[-1][0]
            
            diff = to_sec(end_time) - to_sec(start_time)
            if diff < 0: diff += 86400
            true_duration = diff + 1
            
            first_valid_offset_bytes = valid_matches[0][1]
            last_valid_offset_bytes = valid_matches[-1][1]
            valid_byte_span = last_valid_offset_bytes - first_valid_offset_bytes
            
            start_offset = 0.0
            if diff > 0 and valid_byte_span > 0:
                bytes_per_sec = valid_byte_span / diff
                start_offset = first_valid_offset_bytes / bytes_per_sec
                
            return start_offset, true_duration
        except Exception as e:
            print(f"[Carver] エラー: {e}")
            return None, None

    def get_avi_frame_count(self, file_path, camera):
        """RawData内のAVIヘッダー(目次)をレントゲンスキャンし、対象カメラの正確な総フレーム数を抽出する"""
        try:
            with open(file_path, 'rb') as f:
                header = f.read(131072) # ヘッダー領域(128KB)のみスキャン
            pos = 0
            strh_positions = []
            while True:
                pos = header.find(b'strh', pos)
                if pos == -1:
                    break
                strh_positions.append(pos)
                pos += 4
            
            video_streams = []
            for pos in strh_positions:
                size = struct.unpack('<I', header[pos+4:pos+8])[0]
                strh_data = header[pos+8 : pos+8+size]
                fccType = strh_data[0:4]
                if fccType in [b'vxxx', b'vids']:
                    dwLength = struct.unpack('<I', strh_data[32:36])[0]
                    video_streams.append(dwLength)
            
            if camera == 'front' and len(video_streams) >= 1:
                return video_streams[0]
            elif camera == 'rear' and len(video_streams) >= 2:
                return video_streams[1]
        except Exception as e:
            print(f"[Carver] 目次解析エラー: {e}")
        return None

    def handle_stream(self, parsed_path):
        # 2. ディレクトリトラバーサル対策：ファイル名部分のみを安全に抽出
        filename = os.path.basename(urllib.parse.unquote(parsed_path.path))
        camera = urllib.parse.parse_qs(parsed_path.query).get('camera', ['front'])[0]
        
        file_path = get_virtual_file_path(filename)
        if not file_path or not os.path.exists(file_path):
            self.send_error(404, "File not found")
            return

        temp_filename = f"{filename}_{camera}.mp4"
        temp_filepath = os.path.join(CACHE_DIR, temp_filename)
        
        self.ensure_mp4_cached(filename, camera, file_path, temp_filepath)

        self.send_response(302)
        self.send_header('Location', f'/cache/{temp_filename}')
        self.end_headers()

    def ensure_mp4_cached(self, filename, camera, file_path, temp_filepath):
        if not os.path.exists(temp_filepath):
            patched_filepath = os.path.join(CACHE_DIR, f"{filename}_patched.avi")
            temp_audio = os.path.join(CACHE_DIR, f"{filename}_audio.bin")
            
            try:
                with open(file_path, 'rb') as f:
                    data = f.read()
                data = data.replace(b'vxxx', b'vids')
                data = data.replace(b'HXXX', b'H264')
                with open(patched_filepath, 'wb') as f:
                    f.write(data)
                    
                # 【Stage 5】マルチRIFF物理スキャン方式（全録音セクション対応）
                audio_data_blocks = []
                try:
                    file_size = len(data)
                    movi_ranges = []
                    search_pos = 0
                    while True:
                        list_pos = data.find(b'LIST', search_pos)
                        if list_pos == -1:
                            break
                        if list_pos + 12 <= file_size:
                            list_size = struct.unpack('<I', data[list_pos+4:list_pos+8])[0]
                            list_type = data[list_pos+8:list_pos+12]
                            if list_type == b'movi':
                                movi_start = list_pos + 12
                                movi_end = min(file_size, list_pos + 8 + list_size)
                                movi_ranges.append((movi_start, movi_end))
                        search_pos = list_pos + 4
                    print(f"[Carver] {len(movi_ranges)}個のmoviセクションを発見")
                    
                    for movi_start, movi_end in movi_ranges:
                        scan_pos = movi_start
                        while scan_pos < movi_end:
                            found = data.find(b'02wb', scan_pos, movi_end)
                            if found == -1:
                                break
                            if found + 8 <= file_size:
                                chunk_size = struct.unpack('<I', data[found+4:found+8])[0]
                                if 100 < chunk_size < 10000:
                                    # 位置ドリフトの自動補正型スキャン
                                    expected_pos = found
                                    real_pos = data.find(b'02wb', expected_pos, min(len(data), expected_pos + 2048))
                                    if real_pos != -1:
                                        actual_size = struct.unpack('<I', data[real_pos+4:real_pos+8])[0]
                                        # 【Stage 5.1 改修】先頭の8バイト管理領域(メタデータ)を完全にバイパスし、異音ノイズを根絶する
                                        if actual_size > 8:
                                            payload_start = real_pos + 8 + 8
                                            chunk_bytes = data[payload_start : payload_start + (actual_size - 8)]
                                            audio_data_blocks.append(chunk_bytes)
                            scan_pos = found + 4
                    print(f"[Carver] 合計{len(audio_data_blocks)}個の音声チャンクを回収完了")
                except Exception as e:
                    print(f"[Carver] マルチRIFF物理スキャンエラー: {e}")
                
                if audio_data_blocks:
                    with open(temp_audio, 'wb') as f:
                        f.write(b"".join(audio_data_blocks))
                else:
                    # 1. コマンドインジェクション対策: 配列形式で安全に処理
                    cmd_audio = [FFMPEG_PATH, "-v", "error", "-y", "-i", patched_filepath, "-map", "0:2", "-f", "data", "-c", "copy", temp_audio]
                    subprocess.run(cmd_audio, stderr=subprocess.DEVNULL)
                
                map_v = "0:0" if camera == "front" else "0:1"
                
                # GPSから割り出した正確な「真の再生時間（秒）」と「開始オフセット」を取得する
                start_offset, true_duration = self.get_true_duration(file_path)
                
                if true_duration:
                    ss_flag = f"-ss {start_offset:.3f}"
                    duration_flag = f"-t {true_duration}"
                else:
                    # GPSが取れなかった場合は、目次ヘッダーからフレーム数を取ってフォールバックする
                    frame_count = self.get_avi_frame_count(file_path, camera)
                    ss_flag = ""
                    duration_flag = f"-frames:v {frame_count}" if frame_count else ""
                
                # 音声サンプルレート: 22050Hz (ネイティブサンプリングレートに完全一致させてバッファ詰まりを防止)
                AUDIO_SAMPLE_RATE = 22050
                af_filter = get_audio_filter()
                
                # 1. コマンドインジェクション対策: subprocess.runの引数を配列に変更
                cmd_vid = [FFMPEG_PATH, "-v", "error", "-y"]
                if true_duration:
                    cmd_vid.extend(["-ss", f"{start_offset:.3f}"])
                cmd_vid.extend(["-i", patched_filepath])
                
                if os.path.exists(temp_audio) and os.path.getsize(temp_audio) > 0:
                    cmd_vid.extend(["-f", "s16le", "-ar", str(AUDIO_SAMPLE_RATE), "-ac", "1"])
                    if true_duration:
                         cmd_vid.extend(["-ss", f"{start_offset:.3f}"])
                    cmd_vid.extend(["-i", temp_audio, "-map", map_v, "-map", "1:0", "-c:v", "copy", "-af", af_filter, "-c:a", "aac"])
                    if true_duration:
                         cmd_vid.extend(["-t", str(true_duration)])
                    else:
                         if duration_flag:
                             cmd_vid.extend(duration_flag.split())
                         cmd_vid.append("-shortest")
                else:
                    cmd_vid.extend(["-map", map_v, "-c:v", "copy"])
                    if true_duration:
                        cmd_vid.extend(["-t", str(true_duration)])
                    elif duration_flag:
                        cmd_vid.extend(duration_flag.split())
                        
                cmd_vid.extend(["-movflags", "+faststart", temp_filepath])
                subprocess.run(cmd_vid, stderr=subprocess.DEVNULL)
                    
            except Exception as e:
                pass
            finally:
                if os.path.exists(patched_filepath): os.remove(patched_filepath)
                if os.path.exists(temp_audio): os.remove(temp_audio)

    def handle_export_merged(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error(400, "Bad Request")
                return
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)
            
            files = data.get('files', [])
            camera = data.get('camera', 'front')
            out_filename = data.get('out_filename', 'merged.mp4')
            
            if not files:
                self.send_error(400, "No files provided")
                return
                
            # 全ファイルのMP4キャッシュを確保する
            cached_files = []
            for filename in files:
                file_path = get_virtual_file_path(filename)
                temp_filename = f"{filename}_{camera}.mp4"
                temp_filepath = os.path.join(CACHE_DIR, temp_filename)
                
                if file_path and os.path.exists(file_path):
                    self.ensure_mp4_cached(filename, camera, file_path, temp_filepath)
                    if os.path.exists(temp_filepath):
                        cached_files.append(temp_filepath)
                        
            if not cached_files:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "ファイルが見つかりません"}).encode())
                return
                
            # FFmpegのConcat(結合)用のテキストファイルを作成
            merged_filepath = os.path.join(CACHE_DIR, out_filename)
            concat_list_path = os.path.join(CACHE_DIR, f"concat_{out_filename}.txt")
            
            with open(concat_list_path, 'w') as f:
                for filepath in cached_files:
                    f.write(f"file '{filepath}'\n")
                    
            # 結合を実行 (-c copy なので無劣化で高速)
            # 1. コマンドインジェクション対策: 配列形式を使用
            cmd_merge = [FFMPEG_PATH, "-v", "error", "-f", "concat", "-safe", "0", "-i", concat_list_path, "-c", "copy", "-y", merged_filepath]
            subprocess.run(cmd_merge, stderr=subprocess.DEVNULL)
            
            if os.path.exists(concat_list_path):
                os.remove(concat_list_path)
                
            if os.path.exists(merged_filepath):
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "url": f"/cache/{out_filename}"}).encode())
            else:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "結合に失敗しました"}).encode())
                
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())

if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    print("======================================================")
    print(" [Anti-Gravity] Android専用エンジン V5.0 (最強音声クリーン化版) ")
    print("======================================================")
    try:
        with socketserver.TCPServer(("", PORT), AndroidServerHandler) as httpd:
            print("▶ ブラウザを開き、 http://localhost:8002 にアクセスしてください")
            httpd.serve_forever()
    except OSError as e:
        if e.errno == 48:
            print("\n【エラー】ポート8002が使用中です。強制停止コマンドを実行してください。")
        else:
            raise
