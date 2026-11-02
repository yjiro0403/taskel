# モデル選定ガイド (M1 8GB / 16GB)

2026 年 11 月時点の調査に基づきます。数値は目安で、Mac の世代・メモリ・同時に動かすアプリで変わります。

## 1. LLM (Ollama)

アプリは LLM に **JSON (structured output)** で生成プランを返させるので、ツール呼び出し非対応の小さいモデルでも動きます。
`think` (推論モード) は既定でオフにしています (M1 では数分かかるため)。

| 用途 | 16GB | 8GB | 備考 |
| --- | --- | --- | --- |
| チャット + プロンプト作成 | `qwen3.5:9b` (約 6.6GB) / `gemma4:e4b` | `qwen3.5:4b` (約 3.4GB) / `qwen3.5:2b` | Qwen 系は日本語と指示追従が良い。Gemma は安全性が強めで NSFW には向かない |
| 添付画像の説明 (画像認識) | `qwen3-vl:8b` / `gemma4:e4b` | `qwen3-vl:4b` / `gemma4:e2b` | 設定の「画像認識モデル」に指定。チャット用と同じモデルでも可 |
| NSFW のプロンプト作成 | `huihui_ai/qwen3-vl-abliterated:8b` | `huihui_ai/qwen3-vl-abliterated:4b` | コミュニティの「abliterated」(拒否除去) 版。品質は公式版より下がることがある |

- 避けるもの: `gpt-oss:20b` (16GB では画像モデルと同居できない)、12B 以上。
- 速度の目安: M1 8GB で 4B q4 が 6–10 tok/s。
- サイズはハードコードせず、アプリの上部バーに `/api/tags` の値を表示しています。

## 2. 画像モデル (ComfyUI の checkpoint)

### メモリ別の現実解

| Mac | 使えるもの | 1 枚あたり | 備考 |
| --- | --- | --- | --- |
| 8GB | **SD1.5 系のみ** (512×768) | 20–70 秒 | SDXL は入らない。Flux 不可 |
| 16GB | **SDXL 系** (832×1216 / 1024²) | 60–110 秒 (20–30 steps) | 高速モード (Lightning/Hyper LoRA) で 15–30 秒。Flux は GGUF Q4/Q5 で数分 |
| 32GB+ | Flux.1 dev GGUF、Z-Image Turbo、Flux.2 Klein 4B (mflux) | 1–4 分 | この構成は本アプリの想定外 |

ComfyUI は MPS 上で fp16 を既定にするので fp16 の checkpoint を選びます。
**`*_fp8*` のファイルは MPS で読み込めません** (fp16 / bf16 / GGUF を使う)。

### おすすめ checkpoint

| 名前 | 系統 | 向き | プロンプト流儀 | NSFW |
| --- | --- | --- | --- | --- |
| Illustrious XL / NoobAI-XL / WAI-NSFW-Illustrious | SDXL (anime) | アニメ・イラスト | Danbooru タグ | 可 (NoobAI は特に) |
| Pony Diffusion V6 XL | SDXL (stylised) | アニメ〜セミリアル | `score_9, score_8_up …` + タグ、CLIP skip 2 | 可 |
| Animagine XL 4.0 | SDXL (anime) | アニメ | タグ (`masterpiece, high score …`) | 限定的 |
| Juggernaut XL / RealVisXL / CyberRealistic XL | SDXL (photoreal) | 実写風 | 自然文 | 派生版による |
| Realistic Vision V6 / majicMIX | SD1.5 (photoreal) | 8GB 向け実写 | タグ + 短文 | 可 |
| Anything V5 / Counterfeit V3 / MeinaMix | SD1.5 (anime) | 8GB 向けアニメ | タグ、CLIP skip 2 | 可 |

アプリは checkpoint 名から系統を推定して (`src/lib/types.ts` の `guessCheckpointFamily`)、
LLM への指示 (タグ or 自然文)、品質タグ、ネガティブ、CLIP skip を自動で切り替えます。
推定が外れる場合は設定の「プロンプトの書き方」と「CLIP skip」で固定できます。

### 入手先

- **Civitai**: 2026 年 4 月以降、NSFW を含むモデルは **civitai.red** (civitai.com は SFW のみ)。
  アカウント設定で 18+ を有効にし、右上の目のアイコンで表示レベルを変更します。
- **Hugging Face**: 公式リポジトリ (例: `Laxhar/noobai-XL-1.0`, `cagliostrolab/animagine-xl-4.0`)。
- ダウンロードしたら `ComfyUI/models/checkpoints/` へ。LoRA は `models/loras/`。

### 系統別の既定パラメータ

| 系統 | Sampler / Scheduler | Steps | CFG | CLIP skip | 補足 |
| --- | --- | --- | --- | --- | --- |
| Pony | euler_ancestral / normal | 25 | 6–7 | 2 | `rating_safe` / `rating_explicit` を自動付与 |
| Illustrious / NoobAI | euler_ancestral / normal | 25–28 | 5–6 | 1 | v-pred 版は Karras 不可、CFG 3.5–5 (未対応: 手動で設定) |
| SDXL photoreal | dpmpp_2m / karras | 30 | 5 | 1 | 自然文 |
| SD1.5 | dpmpp_2m / karras | 20 | 7 | 2 | 512×768 |
| Lightning / Hyper (高速モード) | euler / sgm_uniform | 4–8 | 1–1.5 | – | 設定の「高速モード」で LoRA を選択 |
| Flux (checkpoint 版) | euler / simple | 4 (schnell) / 20 | 1 | – | ネガティブ無効。16GB では GGUF 推奨 (本アプリは未対応) |

既定値は設定で変更できます。アスペクト比は LLM が構図から選び、SDXL は約 1MP、SD1.5 は約 0.3MP の 64 の倍数に丸めます。

## 3. 高速モード (SDXL-Lightning / Hyper-SD)

16GB M1 で 4 枚生成に 5 分以上かかるのを 1–2 分にする方法です。

1. `ByteDance/SDXL-Lightning` の `sdxl_lightning_8step_lora.safetensors` (または Hyper-SD の SDXL 8-step LoRA) を `models/loras/` に置く。
2. 設定 → 「高速モード」をオン → LoRA を選択 → Steps 8。
3. アプリが euler + sgm_uniform, CFG 1.5 に切り替えて生成します (Flux / SD1.5 では無効)。

## 4. 他のバックエンド (未実装・参考)

- **mflux** (MLX ネイティブ): Flux.2 Klein 4B / Z-Image Turbo を 4bit で動かせる。HTTP サーバーはコミュニティの `mfluxible` (port 8420)。
- **Draw Things** (App Store): SDXL が ComfyUI より速いという報告あり。Advanced タブで A1111 互換 API (port 7860) を有効化できる。
- 本アプリの `src/lib/server/comfy.ts` を差し替えれば他バックエンドにも対応できます ([ARCHITECTURE.md](ARCHITECTURE.md))。
