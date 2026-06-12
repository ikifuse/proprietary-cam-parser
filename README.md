# proprietary-cam-parser

Experimental viewer and parser for proprietary recording data with GPS synchronization, developed on a rooted Pixel 6a.

---

## 🚀 Overview / 概要

This project is an experimental tool for parsing proprietary camera-like recording data and synchronizing it with GPS information.

このプロジェクトは、独自形式の録画データを解析し、GPS情報と同期して扱うための実験的ツールです。

It aims to unify video, audio, and GPS into a single timeline view.

映像・音声・GPSを1つの時系列として統合することを目的としています。

---

## 📊 Current Status / 現在の状態

✅ FVFS parsing implemented / FVFSパース実装済み  
✅ Video extraction working / 映像抽出成功  
✅ GPS extraction working / GPS抽出成功  
✅ Android execution confirmed / Android実機動作確認済み  

⚠ Audio reconstruction contains noise / 音声再構築にノイズあり  
⚠ Data structure not fully understood / 構造解析は未完了  
⚠ Performance optimization required / 最適化が必要  
⚠ Further validation needed / 追加検証が必要  

---

## 🔍 What I currently believe / 現在の仮説

🧠 These are experimental findings based on ~100 hours of testing.

🧠 約100時間の検証から得られた実験的な仮説です。

* Video streams may be stored in RIFF-like chunk structures  
　映像はRIFF風のチャンク構造で保存されている可能性

* GPS data (location, speed, UTC timestamps) can be extracted and synchronized  
　GPSデータは抽出・同期可能

* Audio appears fragmented across multiple locations  
　音声は複数箇所に分散している可能性

* Metadata may exist near file footer regions  
　メタデータはファイル末尾付近に存在する可能性

* Day/night recordings may be mixed together  
　昼夜の録画データが混在している可能性

⚠ These are not fully verified / これらは未検証です

---

## 🧪 Help Wanted / 協力依頼

🙏 I am a beginner in AI-assisted development.

🙏 私はAI支援開発を始めたばかりの初心者です。

I would appreciate advice on:

以下の分野でアドバイスをいただけると助かります：

- 🎧 Audio reconstruction / 音声再構築  
- 🛰 GPS synchronization / GPS同期  
- ⚙ Performance optimization / パフォーマンス改善  
- 🧪 Testing and validation / テスト・検証  

---

## 🏗 Architecture / 構造

📥 Input data  
⬇  
🧩 Parser  
⬇  
🎬 Video extraction + 🛰 GPS extraction + 🎧 Audio analysis (WIP)  
⬇  
🖥 Unified viewer  

---

## ⚙ Environment / 環境

- 📱 Rooted Pixel 6a / root化済みPixel 6a  
- 🤖 Android execution environment / Android実行環境  
- 🧠 AI-assisted development / AI支援開発  

---

## 👤 About / 作者について

I'm not a professional engineer. I've only been studying AI for 14 days. I can't write any code and I don't understand it at all, which is why I came here.

私はプロのエンジニアではありません。AIを勉強し始めてまだ14日目です。コードも一切書けないしわからないからここにきました

This project was created to better understand real-world operational recording data.

このプロジェクトは現場の記録データをより正確に理解するために作られました。

Development is done through iterative AI-assisted experimentation.

AIを使った試行錯誤ベースで開発しています。

---

## ⚠ Disclaimer / 注意

This project is experimental and may include incorrect assumptions.

本プロジェクトは実験的であり、誤った仮説を含む可能性があります。

---

## 🤝 Contributing / 協力

💬 Feedback from reverse engineering or data parsing experience is welcome.

💬 リバースエンジニアリングやデータ解析経験者からのフィードバックを歓迎します。
