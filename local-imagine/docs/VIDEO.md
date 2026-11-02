# 動画生成 (実験的)

結論から: **M1 8–16GB で実用的な動画生成は AnimateDiff (SD1.5) の短いループ動画まで** です。8GB では非対応と考えてください。
2026 年 11 月時点で ComfyUI の MPS バックエンドには動画モデルに直撃する未解決の問題があります:

- Wan 2.2 TI2V-5B は Apple Silicon で **約 9–17 フレームを超えると無音で絵が崩れる** (Comfy-Org/ComfyUI issue #15793、fp16/bf16/fp32/GGUF いずれも)。
- LTX-2.x の bf16 は真っ黒な動画になる (`--use-split-cross-attention` で回避、issue #15818)。ComfyUI-LTXVideo は MPS 未対応。
- 巨大な attention 行列 (約 2^31 要素) で出力が無音で壊れる (issue #14837)。解像度×フレーム数は小さく保つ。
- fp8 のモデルは MPS で動かない。GGUF も実行時は 16bit に戻るのでメモリ節約にはならない。
- 速度の報告: LTX-Video が M1 16GB で 1 本 15 分、Wan 2.2 GGUF が M1 Max 64GB で 2 秒クリップに 82 分。

本アプリでは動画を「設定で有効化すれば使える」実験機能として残しています。

## 使い方

1. 設定 → 動画 (実験的) → 「動画生成を有効にする」。
2. 方式を選ぶ (下記)。
3. 画像のライトボックスで **動画化** → その画像を起点 (Wan) またはプロンプトのみ (AnimateDiff) で生成。
   生成物は `data/images/<chatId>/*.mp4` に保存され、チャット内で再生できます。

## 方式 A: AnimateDiff (SD1.5) — 軽量・推奨

必要なもの:

- カスタムノード `ComfyUI-AnimateDiff-Evolved` (README に Mac M1/M2/M3 対応と明記) と `ComfyUI-VideoHelperSuite` — `scripts/setup-comfyui.sh` が導入します
- `brew install ffmpeg` (VideoHelperSuite が mp4 を書き出すのに必要) — **手動**
- モーションモジュール `models/animatediff_models/mm_sd_v15_v2.ckpt` — **手動でダウンロード**
  (`curl -L -o ../ComfyUI/models/animatediff_models/mm_sd_v15_v2.ckpt https://huggingface.co/guoyww/animatediff/resolve/main/mm_sd_v15_v2.ckpt`)
- SD1.5 の checkpoint (設定の「SD1.5 checkpoint」。未指定なら既定 checkpoint)

既定: 512×512、16 フレーム、8 fps、20 steps。16GB で 2–5 分程度。
グラフ: `CheckpointLoaderSimple → ADE_AnimateDiffLoaderGen1(mm_sd_v15_v2) → KSampler(batch=frames) → VAEDecode → VHS_VideoCombine(h264 mp4, yuv420p)`

フレームが真っ黒になる場合は AnimateDiff-Evolved issue #48 (unlimited_area_hack) と `--fp32-vae` / `--force-fp16` を試してください。
ComfyUI の起動に `--use-split-cross-attention` を足すと MPS の attention 不具合を避けられることがあります (`COMFY_ARGS="--use-split-cross-attention" bash scripts/start-all.sh`)。

注意: プロンプトは SD1.5 向けに合成されますが、SDXL 用 checkpoint で生成した画像の「動画化」ボタンから呼ぶと
プロンプトは SDXL 時のものが流用されます。品質が悪ければチャット欄から直接、短いタグで依頼してください。

## 方式 B: Wan 2.2 TI2V 5B — 32GB+ の Mac 向け。MPS では現状 壊れやすい

ComfyUI コアノード (`Wan22ImageToVideoLatent`, `CreateVideo`, `SaveVideo`) を使う image-to-video です。
上記 issue #15793 の通り、Apple Silicon では短いフレーム数 (9 程度) でしかまともな出力が得られないという報告があり、
**M1 では「動くかもしれない」以上のものではありません**。NVIDIA 環境の ComfyUI に接続する場合にはそのまま使えます。

必要なファイル (Comfy-Org の Wan 2.2 テンプレートと同じ):

```
models/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors
models/text_encoders/umt5_xxl_fp16.safetensors      ← fp8 版は MPS で読めないので fp16 (約 11GB)
models/vae/wan2.2_vae.safetensors
```

5B fp16 (約 10GB) + umt5 fp16 (約 11GB) で 16GB には収まりません。32GB 以上の Mac で、
640×640・33 フレーム・20 steps から試してください。VAE が bf16 で極端に遅い場合は ComfyUI を `--fp16-vae` で起動します。

## 他の選択肢 (未対応)

| 方法 | 状況 |
| --- | --- |
| LTX-Video / LTX-2 | MPS で NaN 出力の報告。要検証 |
| SVD (img2vid) | 古いが軽め。ComfyUI の SVD ノードで可能。必要なら `workflows.ts` にグラフを追加 |
| LTX-Video 2B distilled (旧 LTX-Video) | fp16 なら M1 16GB で 1 本 15 分程度の報告。フレーム数は 8n+1、解像度は 32 の倍数。`workflows.ts` に未実装 |
| Draw Things | Wan 2.2 5B を Mac ネイティブで提供 (16GB+)。16GB M1 で Wan を試すなら ComfyUI よりこちら。API 連携は未実装 |
| mlx-video / mlx-gen / ltx-video-mac | MLX ネイティブだが Wan 5B bf16 は約 21GiB、LTX は 32GB 以上が前提 |
