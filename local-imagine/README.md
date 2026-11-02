# Local Imagine — ローカル LLM × ComfyUI の画像生成スタジオ

Grok Imagine のように「人物」を作り、その人物とチャットしながら何枚も画像を生成する Web アプリです。
**すべてが自分の Mac (Apple Silicon) の中で完結**します。クラウド API もアカウントも不要です。

```
あなた  ──チャット──▶  ローカル LLM (Ollama)  ──生成プラン──▶  ComfyUI (Stable Diffusion 系)  ──画像──▶  ギャラリー
                       「ポーズを変えて」「赤いドレスで」           SD1.5 / SDXL / Pony / Illustrious ...
```

| 要件 | 対応 |
| --- | --- |
| ローカル LLM のモデル選択 | 上部バーで Ollama のモデルを切り替え。画像認識用モデルも別に指定可 |
| NSFW | 設定 + 人物ごとの 2 段階スイッチ。フィルタは無く、使う checkpoint 次第 ([docs/MODELS.md](docs/MODELS.md)) |
| ポーズ・着せ替えをチャットで指示 | LLM がシーン/ポーズ/衣装/構図をプロンプト化。人物の外見は毎回自動挿入 |
| 複数の「人物」とチャット | 左サイドバーで人物とチャットを管理。生成画像は人物ごとに保存 |
| 人物データ (LoRA 的なもの) | 参照画像 → IP-Adapter、学習済み LoRA の読込 ([docs/PERSONA_AND_LORA.md](docs/PERSONA_AND_LORA.md)) |
| 動画 | 実験的。AnimateDiff (軽量) / Wan 2.2 (重い) ([docs/VIDEO.md](docs/VIDEO.md)) |

## 動作環境

- Mac M1 以降 (16GB 推奨。8GB は SD1.5 のみ現実的)、macOS 14+
- Node.js 20+ (開発は 22)、Python 3.10–3.12、git
- [Ollama](https://ollama.com) と [ComfyUI](https://github.com/comfyanonymous/ComfyUI)

## クイックスタート (約 15 分 + モデルのダウンロード)

```bash
# 1. Ollama を入れて LLM を取得 (16GB: qwen3.5:9b / 8GB: qwen3.5:4b など)
brew install --cask ollama            # または https://ollama.com からインストール
ollama pull qwen3.5:9b

# 2. ComfyUI を Apple Silicon 用にセットアップ (../ComfyUI に clone します)
cd local-imagine
bash scripts/setup-comfyui.sh

# 3. checkpoint を ../ComfyUI/models/checkpoints に置く (docs/MODELS.md 参照)
#    (任意) 参照画像で人物を揃えるための IP-Adapter 重みを取得
bash scripts/download-ipadapter.sh ../ComfyUI sdxl

# 4. まとめて起動 (Ollama, ComfyUI, アプリ)
npm install
bash scripts/start-all.sh
# → http://localhost:3100
```

個別に起動する場合:

```bash
ollama serve
cd ../ComfyUI && source venv/bin/activate && python main.py --listen 127.0.0.1 --port 8188 --preview-method auto
cd local-imagine && npm run dev
```

詳細は [docs/SETUP.md](docs/SETUP.md) を参照してください。

## 使い方

1. 左上の **人物を追加** → 右パネルで「外見 (appearance)」にタグを書く (例: `1girl, long silver hair, blue eyes, adult woman`)。
   ここに書いたものは **毎回のプロンプトに自動挿入** されるので、同じ人物になります。
2. 上部バーで **LLM モデル** と **画像モデル (checkpoint)** を選ぶ。
3. 入力欄に「カフェでコーヒーを飲んでいるところを 4 枚」のように書いて送信。
   LLM が返答と生成プランを返し、ComfyUI が 1 枚ずつ描画します (進捗バー付き)。
4. 「別のポーズで」「赤いドレスに着せ替えて」「横顔のクローズアップ」と会話を続ける。
5. 画像をクリック → ライトボックスで **保存 / 参照に追加 / バリエーション ×4 / 動画化**。
   「参照に追加」で気に入った画像を人物の参照画像にすると、以降 IP-Adapter で顔や雰囲気が揃います。

### 画面構成

```
┌ 人物 ─────────┐┌ チャット (人物名 / LLM / checkpoint / 枚数) ─────────┐┌ 人物を編集 ┐
│ ● Aoi          ││  あなた: ビーチで遊んでいるところを 3 枚            ││ 名前        │
│ ● Mika   18+   ││  Aoi 監督: 了解です、3 枚生成します                  ││ 外見        │
│                ││  [画像][画像][画像]  832×1216 · 25 steps · 9s      ││ 画風        │
│ チャット        ││                                                    ││ 参照画像     │
│ ▸ ビーチ        ││  [別のポーズ][別のアングル][着せ替え][表情いろいろ]   ││ LoRA        │
│ ▸ カフェ        ││  ┌──────────────────────────────┐ [送信]           ││ NSFW        │
└───────────────┘└────────────────────────────────────────────────────┘└───────────┘
```

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | Ollama / ComfyUI / アプリのインストールと起動、Comfy Desktop を使う場合 |
| [docs/MODELS.md](docs/MODELS.md) | M1 8GB/16GB で現実的な LLM・画像モデル、NSFW 対応モデルの入手先、プロンプト流儀 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 作り方: データモデル、API、エージェントの仕組み、ComfyUI ワークフロー、拡張方法 |
| [docs/PERSONA_AND_LORA.md](docs/PERSONA_AND_LORA.md) | 「この子の画像を作って」を実現する 3 段階 (プロンプト → IP-Adapter → LoRA) |
| [docs/VIDEO.md](docs/VIDEO.md) | 動画生成の現実的な選択肢と設定 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 黒い画像、メモリ不足、接続できない、など |
| [docs/RESEARCH_BRIEFING.md](docs/RESEARCH_BRIEFING.md) | (英語) 設計の根拠にした 2026-11 時点の調査まとめ: API 仕様、モデル、MPS の既知問題、出典 URL |

## 開発

```bash
npm run dev        # http://localhost:3100
npm run typecheck
npm run lint
npm test           # プロンプト合成・ワークフロー生成のユニットテスト
node scripts/mock-backends.mjs   # GPU なしで UI を触るためのモック Ollama/ComfyUI
OLLAMA_URL=http://127.0.0.1:11435 COMFYUI_URL=http://127.0.0.1:8189 npm run dev
```

データ (人物・チャット・生成画像) は `local-imagine/data/` に JSON と PNG で保存されます。バックアップはこのフォルダをコピーするだけです。

## 注意事項

- NSFW を有効にしても、**未成年に見える描写・実在人物・性的暴力** は LLM のシステムプロンプトで禁止しています。モデル自体にフィルタは無いので、最終的な責任は利用者にあります。
- Flux.1 dev / Kontext などは非商用ライセンスです。モデルごとのライセンスを確認してください。
- このアプリは localhost 専用です。LAN に公開する設計にはなっていません (認証なし)。
